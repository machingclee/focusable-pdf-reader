/**
 * Integration test for the RTK Query endpoints against a real backend.
 *
 * It spawns `backend/src/main.ts` on a throwaway SQLite database and a random
 * port, so it needs Bun and `backend/node_modules`; it skips itself otherwise.
 *
 * The endpoints are exercised through the app's own store, which is also what
 * proves the parts a unit test cannot: the runtime base-URL seam, the token
 * header, tag invalidation, and the response shapes the components read.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPrismaClient } from "../backend/src/infrastructure/prisma/client.ts";
import { libraryDirFor } from "../backend/src/common/library.ts";
import { apiErrorMessage } from "../src/store/api/baseApi";
import { appStateApi } from "../src/store/api/appStateApi";
import { noteApi } from "../src/store/api/noteApi";
import { noteFolderApi } from "../src/store/api/noteFolderApi";
import { historyApi } from "../src/store/api/historyApi";
import { pdfDocumentApi } from "../src/store/api/pdfDocumentApi";
import { annotationApi } from "../src/store/api/annotationApi";
import { pdfTagApi } from "../src/store/api/pdfTagApi";
import { setBackendTargetOverride } from "../src/store/api/targetOverride";
import { store } from "../src/store/store";
import type {
  Note,
  ImportDocumentInput,
  NewAnnotationInput,
  NewStripInput,
  PdfDocumentWithNotes,
  StripFilter,
  UpdateAppStateInput,
  UpdateStripInput,
} from "../src/types/dto";
import {
  CONTEXT_HISTORY_MANAGEMENT,
  CONTEXT_PDF_NOTES_MANAGEMENT,
  CONTEXT_PDF_TAG_MANAGEMENT,
} from "../backend/src/bounded-contexts/constants.ts";

const backendDir = resolve(import.meta.dir, "..", "backend");
const backendAvailable = existsSync(join(backendDir, "node_modules"));
const READY_PATTERN = /BACKEND_READY port=(\d+)/;

type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  errorMessage?: string;
};

async function responseData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!body.success) throw new Error(body.errorMessage ?? "API response failed");
  return body.data as T;
}

let child: { kill: () => void } | undefined;
/**
 * The run's own folder. The database and the PDF library that sits beside it are
 * both throwaway, so a test run never reads notes or copies left by another.
 */
let databaseDir: string | undefined;
let databasePath: string | undefined;
let port = 0;

/* ── endpoint helpers ─────────────────────────────────────────
   `initiate(...).unwrap()` is the store-level equivalent of calling the hook,
   minus React. `forceRefetch` is what keeps the assertions honest: RTK Query
   would otherwise answer a repeated read from its cache, and these tests are
   about what the backend actually stored. */

const listDocuments = () =>
  store
    .dispatch(pdfDocumentApi.endpoints.listDocuments.initiate(undefined, { forceRefetch: true }))
    .unwrap();

/**
 * Resolve a document for a test, and let go of it again.
 *
 * The subscription is released on purpose. `getOrCreateDocument` is a query, so
 * a live subscriber is re-run whenever `PdfDocument` is invalidated — and that
 * re-POSTs `/resolve`, which upserts. A test that moves a document to a new path
 * would otherwise find a fresh, empty row recreated at the path it moved away
 * from, by a subscriber nobody is using.
 */
const resolveDocument = async (body: {
  file_path: string;
  name?: string;
  update_name?: boolean;
  in_new_window?: boolean;
}) => {
  // Resolve refuses a path with no file. The paths these tests invent are not
  // real PDFs, so the missing ones are created here and left for the next test.
  if (!existsSync(body.file_path)) writeFileSync(body.file_path, "%PDF-1.4\n%%EOF\n");
  const request = store.dispatch(
    pdfDocumentApi.endpoints.getOrCreateDocument.initiate(body, { forceRefetch: true }),
  );
  try {
    return await request.unwrap();
  } finally {
    request.unsubscribe();
  }
};
const renameDocument = (id: number, name: string) =>
  store.dispatch(pdfDocumentApi.endpoints.renameDocument.initiate({ id, name })).unwrap();

const listStrips = (filter: StripFilter) =>
  store
    .dispatch(noteApi.endpoints.listStrips.initiate(filter, { forceRefetch: true }))
    .unwrap();

const createStrip = (body: NewStripInput): Promise<Note> =>
  store.dispatch(noteApi.endpoints.createStrip.initiate(body)).unwrap();

const updateStrip = (body: UpdateStripInput) =>
  store.dispatch(noteApi.endpoints.updateStrip.initiate(body)).unwrap();

/** One strip by id: what a `[note:<id>]` reference in another note resolves to. */
const getStrip = (id: number) =>
  store
    .dispatch(noteApi.endpoints.getStrip.initiate(id, { forceRefetch: true }))
    .unwrap();

const deleteStrip = (id: number) =>
  store.dispatch(noteApi.endpoints.deleteStrip.initiate(id)).unwrap();

const listAnnotations = (pdfDocumentId: number) =>
  store
    .dispatch(
      annotationApi.endpoints.listDocumentAnnotations.initiate(pdfDocumentId, { forceRefetch: true }),
    )
    .unwrap();

/** One pin by id: what a `[annotation:<id>]` reference in a note resolves to. */
const getAnnotation = (id: number) =>
  store
    .dispatch(annotationApi.endpoints.getAnnotation.initiate(id, { forceRefetch: true }))
    .unwrap();

const createAnnotation = (documentId: number, body: NewAnnotationInput) =>
  store.dispatch(annotationApi.endpoints.createAnnotation.initiate({ documentId, ...body })).unwrap();

const updateAnnotationText = (id: number, text: string) =>
  store.dispatch(annotationApi.endpoints.updateAnnotation.initiate({ id, text })).unwrap();

const setAnnotationFontSize = (id: number, font_size: number) =>
  store.dispatch(annotationApi.endpoints.updateAnnotation.initiate({ id, font_size })).unwrap();

const moveAnnotation = (id: number, page_number: number, x: number, y: number) =>
  store
    .dispatch(annotationApi.endpoints.updateAnnotation.initiate({ id, page_number, x, y }))
    .unwrap();

const deleteAnnotation = (id: number) =>
  store.dispatch(annotationApi.endpoints.deleteAnnotation.initiate(id)).unwrap();

const listFolders = (pdfDocumentId: number) =>
  store
    .dispatch(
      noteFolderApi.endpoints.listFolders.initiate({ pdf_document_id: pdfDocumentId }, { forceRefetch: true }),
    )
    .unwrap();

const createFolder = (pdfDocumentId: number, name: string) =>
  store.dispatch(noteFolderApi.endpoints.createFolder.initiate({ pdf_document_id: pdfDocumentId, name })).unwrap();

const reorderFolders = (pdfDocumentId: number, folderIds: number[]) =>
  store
    .dispatch(
      noteFolderApi.endpoints.reorderFolders.initiate({ pdf_document_id: pdfDocumentId, note_folder_ids: folderIds }),
    )
    .unwrap();

const reorderStrips = (pdfDocumentId: number, groups: { note_folder_id: number | null; note_ids: number[] }[]) =>
  store.dispatch(noteApi.endpoints.reorderStrips.initiate({ pdf_document_id: pdfDocumentId, groups })).unwrap();

const reorderDocuments = (documentIds: number[]) =>
  store.dispatch(pdfDocumentApi.endpoints.reorderDocuments.initiate({ document_ids: documentIds })).unwrap();

const deleteFolder = (id: number, withStrips = false) =>
  store.dispatch(noteFolderApi.endpoints.deleteFolder.initiate({ id, with_strips: withStrips })).unwrap();

const deleteDocument = (id: number) =>
  store.dispatch(pdfDocumentApi.endpoints.deleteDocument.initiate(id)).unwrap();

const importDocuments = (body: ImportDocumentInput) =>
  store.dispatch(pdfDocumentApi.endpoints.importDocument.initiate(body)).unwrap();

/** One path, still the common case: the endpoint always answers with a list. */
const importDocument = async (sourcePath: string, name?: string): Promise<PdfDocumentWithNotes> => {
  const documents = await importDocuments({ source_paths: [sourcePath], name });
  if (!documents[0]) throw new Error("import returned no document");
  return documents[0];
};

const getAppState = () =>
  store
    .dispatch(appStateApi.endpoints.getAppState.initiate(undefined, { forceRefetch: true }))
    .unwrap();

const updateAppState = (body: UpdateAppStateInput) =>
  store.dispatch(appStateApi.endpoints.updateAppState.initiate(body)).unwrap();

/** Resolve a document by path, returning the row the other tests use. */
async function seedDocument(): Promise<PdfDocumentWithNotes> {
  return resolveDocument({ file_path: "/tmp/api-test-document.pdf", name: "file name" });
}

async function startBackend(): Promise<number> {
  databaseDir = mkdtempSync(join(tmpdir(), "pdf-focus-viewer-api-test-"));
  databasePath = join(databaseDir, "database.db");
  const process_ = Bun.spawn([process.execPath, "src/main.ts"], {
    cwd: backendDir,
    env: {
      ...process.env,
      DATABASE_URL: `file:${databasePath}`,
      PORT: "0",
      BACKEND_STDIN_WATCHDOG: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  child = process_;

  const reader = process_.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value);
    const match = buffered.match(READY_PATTERN);
    if (match?.[1]) {
      reader.releaseLock();
      return Number.parseInt(match[1], 10);
    }
  }

  const stderr = await new Response(process_.stderr).text();
  throw new Error(`backend did not report a port.\nstdout:\n${buffered}\nstderr:\n${stderr}`);
}

describe.skipIf(!backendAvailable)("api endpoints", () => {
  beforeAll(async () => {
    port = await startBackend();
    setBackendTargetOverride({ baseUrl: `http://127.0.0.1:${port}`, token: null });
  }, 30_000);

  afterAll(() => {
    setBackendTargetOverride(null);
    child?.kill();
    if (databaseDir) rmSync(databaseDir, { recursive: true, force: true });
  });

  test("health answers", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);
    const health = await responseData<{ status: string; pid: number }>(response);
    expect(health.status).toBe("ok");
    expect(health.pid).toBeGreaterThan(0);
  });

  test("the OpenAPI document describes every route", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api-docs.json`);
    expect(response.status).toBe(200);

    const doc = (await response.json()) as {
      openapi: string;
      info: { title: string };
      paths: Record<string, Record<string, unknown>>;
    };

    expect(doc.openapi).toBe("3.0.3");
    expect(doc.info.title).toBe("PDF Focus Viewer API");
    expect(Object.keys(doc.paths).sort()).toEqual([
      "/annotations/:id",
      "/app-state",
      // The diagram's documented entry point; the page itself is static and
      // lives outside the API surface, at /event-storming/.
      "/docs/command-flow",
      "/docs/commands",
      "/event-audit",
      "/health",
      "/history/redo",
      "/history/undo",
      "/note-folders",
      "/note-folders/:id",
      "/note-folders/reorder",
      "/notes",
      "/notes/:id",
      "/notes/reorder",
      "/pdf-document-folders",
      "/pdf-document-folders/:id",
      "/pdf-document-folders/:id/documents",
      "/pdf-document-folders/:id/documents/reorder",
      "/pdf-document-folders/reorder",
      "/pdf-documents",
      "/pdf-documents/:id",
      "/pdf-documents/:id/annotations",
      "/pdf-documents/:id/highlights",
      "/pdf-documents/:id/rename",
      "/pdf-documents/:id/tags",
      "/pdf-documents/:id/tags/copy",
      "/pdf-documents/import",
      "/pdf-documents/reorder",
      "/pdf-documents/resolve",
      "/pdf-tags",
      "/pdf-tags/:id",
      "/pdf-tags/folders",
      "/pdf-tags/folders/:id",
      "/pdf-tags/folders/reorder",
    ]);
    expect(Object.keys(doc.paths["/annotations/:id"] ?? {}).sort()).toEqual([
      "delete",
      "get",
      "patch",
    ]);
    expect(Object.keys(doc.paths["/pdf-documents/:id/annotations"] ?? {}).sort()).toEqual([
      "get",
      "post",
    ]);
    expect(Object.keys(doc.paths["/notes"] ?? {}).sort()).toEqual(["get", "post"]);
    expect(Object.keys(doc.paths["/notes/:id"] ?? {}).sort()).toEqual([
      "delete",
      "get",
      "patch",
    ]);
    expect(Object.keys(doc.paths["/notes/reorder"] ?? {}).sort()).toEqual(["post"]);
    expect(Object.keys(doc.paths["/note-folders"] ?? {}).sort()).toEqual(["get", "post"]);
    expect(Object.keys(doc.paths["/note-folders/:id"] ?? {}).sort()).toEqual(["delete", "patch"]);
    expect(Object.keys(doc.paths["/note-folders/reorder"] ?? {}).sort()).toEqual(["post"]);
    expect(Object.keys(doc.paths["/pdf-document-folders"] ?? {}).sort()).toEqual(["get", "post"]);
    expect(Object.keys(doc.paths["/pdf-document-folders/:id"] ?? {}).sort()).toEqual(["delete", "patch"]);
    expect(Object.keys(doc.paths["/pdf-document-folders/:id/documents"] ?? {}).sort()).toEqual(["delete", "post"]);
    expect(Object.keys(doc.paths["/pdf-document-folders/:id/documents/reorder"] ?? {}).sort()).toEqual(["post"]);
    expect(Object.keys(doc.paths["/pdf-document-folders/reorder"] ?? {}).sort()).toEqual(["post"]);
    expect(Object.keys(doc.paths["/pdf-documents/reorder"] ?? {}).sort()).toEqual(["post"]);
    expect(Object.keys(doc.paths["/pdf-documents/:id"] ?? {}).sort()).toEqual(["delete"]);
    expect(Object.keys(doc.paths["/pdf-documents/:id/rename"] ?? {}).sort()).toEqual(["patch"]);
    expect(Object.keys(doc.paths["/pdf-documents/:id/tags"] ?? {}).sort()).toEqual(["delete", "post"]);
    expect(Object.keys(doc.paths["/pdf-documents/:id/tags/copy"] ?? {}).sort()).toEqual(["post"]);
    expect(Object.keys(doc.paths["/pdf-tags"] ?? {}).sort()).toEqual(["get", "post"]);
    expect(Object.keys(doc.paths["/pdf-tags/:id"] ?? {}).sort()).toEqual(["delete", "patch"]);
    expect(Object.keys(doc.paths["/pdf-tags/folders"] ?? {}).sort()).toEqual(["get", "post"]);
    expect(Object.keys(doc.paths["/pdf-tags/folders/:id"] ?? {}).sort()).toEqual(["delete", "patch"]);
    expect(Object.keys(doc.paths["/pdf-tags/folders/reorder"] ?? {}).sort()).toEqual(["post"]);
    // Deleting a folder documents the flag that also deletes its strips.
    const folderDelete = doc.paths["/note-folders/:id"]?.delete as
      | { parameters?: { name: string; in: string; required: boolean }[] }
      | undefined;
    expect(folderDelete?.parameters).toEqual([
      { name: "with_strips", in: "query", required: false, schema: expect.anything() },
    ]);
    expect(Object.keys(doc.paths["/app-state"] ?? {}).sort()).toEqual(["get", "patch"]);
  });

  test("the Swagger UI page is served", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api-docs/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("swagger-ui");
  });

  test("an invalid body is rejected in the API's error envelope", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pdf_document_id: 0 }),
    });

    expect(response.status).toBe(400);
    const payload = (await response.json()) as ApiEnvelope;
    expect(payload.success).toBe(false);
    expect(payload.errorMessage).toContain("Validation failed");
  });

  let documentId = 0;

  test("resolveDocument creates the document with a numeric created_at", async () => {
    const before = Date.now();
    const document = await resolveDocument({
      file_path: "/tmp/api-test-document.pdf",
      name: "api test",
      page_count: 12,
      fingerprint: "fingerprint-1",
    });
    const after = Date.now();

    expect(document.id).toBeGreaterThan(0);
    expect(document.name).toBe("api test");
    expect(document.page_count).toBe(12);
    expect(typeof document.created_at).toBe("number");
    expect(document.created_at).toBeGreaterThanOrEqual(before);
    expect(document.created_at).toBeLessThanOrEqual(after);
    expect(document).not.toHaveProperty("updated_at");
    expect(document.notes).toEqual([]);
    documentId = document.id;
  });

  test("resolveDocument keeps an edited name unless update_name is set", async () => {
    const renamed = await renameDocument(documentId, "my notes");
    expect(renamed.name).toBe("my notes");

    const reopened = await resolveDocument({ file_path: "/tmp/api-test-document.pdf", name: "file name" });
    expect(reopened.name).toBe("my notes");

    const forced = await resolveDocument({
      file_path: "/tmp/api-test-document.pdf",
      name: "file name",
      update_name: true,
    });
    expect(forced.name).toBe("file name");
  });

  test("strips round-trip", async () => {
    const strip = await createStrip({
      pdf_document_id: documentId,
      page_number: 3,
      top: 120.5,
      height: 42,
      left: 72,
      width: 451,
      page_width: 595,
      page_height: 842,
      text_excerpt: "It was the best of times",
      remark: "# Note",
    });
    expect(strip.expanded).toBe(true);
    expect(strip.id).toBeGreaterThan(0);
    expect(strip.page_number).toBe(3);
    expect(strip.note_folder_id).toBeGreaterThan(0);
    expect(strip.ordering).toBe(0);
    // A strip names its document directly now that a folder is optional: it has
    // to be listable when it is in no folder at all.
    expect(strip.pdf_document_id).toBe(documentId);
    expect(typeof strip.created_at).toBe("number");

    const listed = await listStrips({ pdf_document_id: documentId });
    expect(listed.map((item) => item.id)).toEqual([strip.id]);
    expect(listed[0]?.pdf_document?.name).toBe("file name");

    // One strip on its own, the way a `[note:<id>]` reference in another note
    // asks for it: no document filter, and the document still comes with it.
    const fetched = await getStrip(strip.id);
    expect(fetched.id).toBe(strip.id);
    expect(fetched.remark).toBe("# Note");
    expect(fetched.pdf_document).toMatchObject({ id: documentId, name: "file name" });

    // One row, two kinds of write: the note, then the geometry a resize sends.
    const noted = await updateStrip({ id: strip.id, remark: "changed" });
    expect(noted.remark).toBe("changed");
    expect(noted.top).toBe(120.5);
    expect(noted.expanded).toBe(true);

    // Folding hides the writing in the card and leaves this flag. A later
    // write that does not mention it must not open the note again.
    const folded = await updateStrip({ id: strip.id, expanded: false });
    expect(folded.expanded).toBe(false);
    expect(folded.remark).toBe("changed");
    const stillFolded = await updateStrip({ id: strip.id, remark: "changed again" });
    expect(stillFolded.expanded).toBe(false);
    expect(stillFolded.remark).toBe("changed again");

    const moved = await updateStrip({
      id: strip.id,
      page_number: 4,
      top: 300.25,
      height: 60,
      left: 80,
      width: 400,
      page_width: 595,
      page_height: 842,
      text_excerpt: null,
    });
    // The geometry is rewritten, and the note the resize did not resend stays.
    expect(moved).toMatchObject({
      id: strip.id,
      page_number: 4,
      top: 300.25,
      height: 60,
      left: 80,
      width: 400,
      text_excerpt: null,
      remark: "changed again",
      expanded: false,
    });

    // A new strip is unmarked. A highlight write replaces the list and leaves
    // the note the write did not resend.
    expect(strip.highlights).toBe("[]");
    const marks = JSON.stringify([{ x0: 72, x1: 400, y: 140, size: 14 }]);
    const marked = await updateStrip({ id: strip.id, highlights: marks });
    expect(marked.highlights).toBe(marks);
    expect(marked.remark).toBe("changed again");
    expect(marked.expanded).toBe(false);
    expect(marked.top).toBe(300.25);
    await expect(updateStrip({ id: strip.id, highlights: "nope" })).rejects.toBeTruthy();

    const reopened = await resolveDocument({ file_path: "/tmp/api-test-document.pdf" });
    expect(reopened.notes.map((item) => item.id)).toEqual([strip.id]);

    await deleteStrip(strip.id);
    expect(await listStrips({ pdf_document_id: documentId })).toEqual([]);
    // A reference to the deleted strip is answered as gone, not as an empty row:
    // the nested note draws that as "was deleted".
    await expect(getStrip(strip.id)).rejects.toMatchObject({ status: 404 });
  });

  test("documents are listed in drag order with strip counts", async () => {
    const documents = await listDocuments();
    expect(documents.length).toBe(1);
    expect(documents[0]?.id).toBe(documentId);
    expect(documents[0]?.ordering).toBe(0);
    expect(documents[0]?._count?.notes).toBe(0);
  });

  test("folders own the strips and both can be reordered", async () => {
    const geometry = {
      page_number: 1,
      height: 20,
      left: 0,
      width: 40,
      page_width: 200,
      page_height: 400,
    };
    const first = await createStrip({ ...geometry, pdf_document_id: documentId, top: 10, text_excerpt: "first" });
    const second = await createStrip({ ...geometry, pdf_document_id: documentId, top: 80, text_excerpt: "second" });

    const before = await listFolders(documentId);
    const home = before[0];
    expect(home?.name).toBe("Notes");
    expect(home?.notes.map((strip) => strip.id)).toEqual([first.id, second.id]);

    const flipped = await reorderStrips(documentId, [
      { note_folder_id: home!.id, note_ids: [second.id, first.id] },
    ]);
    expect(flipped[0]?.notes.map((strip) => strip.id)).toEqual([second.id, first.id]);
    expect(flipped[0]?.notes.map((strip) => strip.ordering)).toEqual([0, 1]);

    const later = await createFolder(documentId, "Later");
    const moved = await reorderStrips(documentId, [
      { note_folder_id: home!.id, note_ids: [second.id] },
      { note_folder_id: later.id, note_ids: [first.id] },
    ]);
    const byId = new Map(moved.map((folder) => [folder.id, folder]));
    expect(byId.get(home!.id)?.notes.map((strip) => strip.id)).toEqual([second.id]);
    expect(byId.get(later.id)?.notes.map((strip) => strip.note_folder_id)).toEqual([later.id]);

    const reordered = await reorderFolders(documentId, [later.id, home!.id]);
    expect(reordered.map((folder) => folder.id)).toEqual([later.id, home!.id]);
    expect(reordered.map((folder) => folder.ordering)).toEqual([0, 1]);

    // "No folder" is the group with a null id: moving `first` out of `later`
    // sends the emptied source and the unfiled destination.
    const unfiledMove = await reorderStrips(documentId, [
      { note_folder_id: later.id, note_ids: [] },
      { note_folder_id: null, note_ids: [first.id] },
    ]);
    expect(unfiledMove.find((folder) => folder.id === later.id)?.notes).toEqual([]);

    const unfiledOnly = await listStrips({ pdf_document_id: documentId, unfiled: true });
    expect(unfiledOnly.map((strip) => strip.id)).toEqual([first.id]);
    expect(unfiledOnly[0]?.note_folder_id).toBeNull();

    // A folder-less strip is still the document's strip: it is counted, and it
    // comes back when the viewer reopens the file.
    expect((await listDocuments())[0]?._count?.notes).toBe(2);
    const reopened = await resolveDocument({ file_path: "/tmp/api-test-document.pdf" });
    expect(reopened.notes.map((strip) => strip.id).sort()).toEqual([first.id, second.id].sort());

    // A group may only list the strips it already holds, so a request cannot
    // silently yank a strip out of a folder it does not name.
    const wrongHome = await fetch(`http://127.0.0.1:${port}/notes/reorder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groups: [{ note_folder_id: home!.id, note_ids: [first.id] }] }),
    });
    expect(wrongHome.status).toBe(400);

    // ...and it can be filed again.
    await reorderStrips(documentId, [
      { note_folder_id: null, note_ids: [] },
      { note_folder_id: later.id, note_ids: [first.id] },
    ]);
    expect(
      (await listFolders(documentId)).find((folder) => folder.id === later.id)?.notes.map((strip) => strip.id),
    ).toEqual([first.id]);

    // A folder that still holds a strip is not removed with it.
    const blocked = await fetch(`http://127.0.0.1:${port}/note-folders/${later.id}`, { method: "DELETE" });
    expect(blocked.status).toBe(400);

    // `with_strips=true` is the deliberate form: the strips go with the folder.
    const doomed = await createFolder(documentId, "Doomed");
    const doomedStrip = await createStrip({ ...geometry, pdf_document_id: documentId, top: 150, note_folder_id: doomed.id });
    // Through the endpoint, so this also proves the flag is serialised onto the
    // query string the backend reads.
    await deleteFolder(doomed.id, true);
    const survivors = await listFolders(documentId);
    expect(survivors.map((folder) => folder.id)).not.toContain(doomed.id);
    expect(survivors.flatMap((folder) => folder.notes).map((strip) => strip.id)).not.toContain(
      doomedStrip.id,
    );

    // The flag is a flag: a value the API does not recognise is a 400, not a
    // silent "true" on a destructive call.
    const mistyped = await fetch(`http://127.0.0.1:${port}/note-folders/${later.id}?with_strips=1`, {
      method: "DELETE",
    });
    expect(mistyped.status).toBe(400);

    await deleteStrip(first.id);
    await deleteStrip(second.id);
    await deleteFolder(later.id);
    await deleteFolder(home!.id);
    expect(await listFolders(documentId)).toEqual([]);
  });

  test("documents can be reordered, and a new one is placed first", async () => {
    const later = await resolveDocument({ file_path: "/tmp/api-test-document-later.pdf", name: "later" });
    const listed = await listDocuments();
    const ids = listed.map((document) => document.id);
    expect(ids[0]).toBe(later.id);
    expect(listed[0]?.ordering).toBe(0);

    const flipped = await reorderDocuments([...ids].reverse());
    expect(flipped.map((document) => document.id)).toEqual([...ids].reverse());
    expect(flipped.map((document) => document.ordering)).toEqual(ids.map((_, index) => index));
    expect((await listDocuments()).map((document) => document.id)).toEqual([...ids].reverse());

    const missing = await fetch(`http://127.0.0.1:${port}/pdf-documents/reorder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document_ids: [later.id] }),
    });
    expect(missing.status).toBe(400);
  });

  test("app state is one row and a patch changes only the sent column", async () => {
    const before = await getAppState();
    expect(before.id).toBe(1);
    expect(before.notes_panel_width).toBeNull();
    expect(before.event_log_panel_width).toBeNull();
    expect(before.notes_documents_width).toBeNull();

    const updated = await updateAppState({ notes_panel_width: 420 });
    expect(updated.notes_panel_width).toBe(420);
    expect(updated.event_log_panel_width).toBeNull();
    expect(updated.notes_documents_width).toBeNull();
    expect(updated.last_opened_pdf_document_id).toBe(before.last_opened_pdf_document_id);

    // The Dashboard tab's split is remembered the same way, and a patch that names
    // it leaves the docked columns alone.
    await updateAppState({ notes_panel_width: 512, event_log_panel_width: 480, notes_documents_width: 340 });
    const after = await getAppState();
    expect(after.notes_panel_width).toBe(512);
    expect(after.event_log_panel_width).toBe(480);
    expect(after.notes_documents_width).toBe(340);
    expect(after.last_opened_pdf_document_id).toBe(before.last_opened_pdf_document_id);
  });

  test("resolving a document remembers it as the last opened", async () => {
    const width = (await getAppState()).notes_panel_width;
    const document = await resolveDocument({
      file_path: "/tmp/api-test-last-opened.pdf",
      name: "last opened",
    });
    const state = await getAppState();
    expect(state.last_opened_pdf_document_id).toBe(document.id);
    expect(state.notes_panel_width).toBe(width);
  });

  test("resolving a document in a new window leaves the last opened document", async () => {
    const remembered = await resolveDocument({
      file_path: "/tmp/api-test-last-opened-kept.pdf",
      name: "kept",
    });
    expect((await getAppState()).last_opened_pdf_document_id).toBe(remembered.id);

    const beside = await resolveDocument({
      file_path: "/tmp/api-test-last-opened-beside.pdf",
      name: "beside",
      in_new_window: true,
    });
    expect(beside.id).not.toBe(remembered.id);
    expect((await getAppState()).last_opened_pdf_document_id).toBe(remembered.id);

    // Opening the same document again in this window still remembers it.
    await resolveDocument({ file_path: "/tmp/api-test-last-opened-beside.pdf", name: "beside" });
    expect((await getAppState()).last_opened_pdf_document_id).toBe(beside.id);
  });

  test("errors surface the backend message through the endpoint", async () => {
    const failure = await updateStrip({ id: 999_999, remark: "nope" }).catch(
      (error: unknown) => error,
    );
    expect((failure as { status?: unknown }).status).toBe(404);
    // The same helper the components use to render an error line.
    expect(apiErrorMessage(failure)).toMatch(/does not exist/);
  });

  /* ── the app's own copy of each PDF ──────────────────────────
     Every test writes its own fixture files: the library is content-addressed,
     so two tests sharing bytes would share a document and one of them would be
     asserting the other's setup. */

  describe("importDocument", () => {
    /** Distinct bytes per test, so no two imports can collide on content. */
    const BOOK = "%PDF-1.4\n%%EOF\n%the book\n";
    const SAME_IN_TWO_FOLDERS = "%PDF-1.4\n%%EOF\n%one copy, two folders\n";
    const OTHER = "%PDF-1.4\n%%EOF\n%another book\n";
    const LEGACY = "%PDF-1.4\n%%EOF\n%notes written before the library\n";
    const ORPHAN = "%PDF-1.4\n%%EOF\n%reopened from its own copy\n";
    const RESTORED = "%PDF-1.4\n%%EOF\n%whose copy gets deleted and restored\n";

    const geometry = {
      page_number: 1,
      top: 100,
      height: 24,
      left: 72,
      width: 400,
      page_width: 595,
      page_height: 842,
    };

    /** Fixture files live beside the run's database, so both are removed together. */
    let fixtures = "";

    /** The library folder the backend beside this database writes into. */
    const library = () => libraryDirFor(databasePath!);

    const writeFixture = (name: string, contents: string): string => {
      const path = join(fixtures, name);
      writeFileSync(path, contents);
      return path;
    };

    /** The copies in the library, so a test can prove none was added. */
    const copiesInLibrary = (): string[] =>
      existsSync(library()) ? readdirSync(library()).filter((name) => name.endsWith(".pdf")) : [];

    beforeAll(() => {
      fixtures = mkdtempSync(join(tmpdir(), "pdf-focus-viewer-import-"));
    });

    afterAll(() => {
      rmSync(fixtures, { recursive: true, force: true });
      rmSync(library(), { recursive: true, force: true });
    });

    test("copies the file into the library and points the document at the copy", async () => {
      const source = writeFixture("book.pdf", BOOK);
      const document = await importDocument(source);

      expect(document.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(document.original_path).toBe(source);
      expect(document.file_path.startsWith(library())).toBe(true);
      expect(document.file_path.endsWith(`${document.content_hash}.pdf`)).toBe(true);
      // The copy is the file, byte for byte, so the viewer reads the same PDF.
      expect(existsSync(document.file_path)).toBe(true);
      expect(readFileSync(document.file_path).toString()).toBe(BOOK);
      // The name comes from the original path, never from the hash.
      expect(document.name).toBe("book");
      expect(document.notes).toEqual([]);

      // Opening the notes column resolves the copy, exactly as the app does: it
      // has to find the imported row rather than create a second one for it.
      const resolved = await resolveDocument({
        file_path: document.file_path,
        name: document.name,
      });
      expect(resolved.id).toBe(document.id);
      const rows = (await listDocuments()).filter(
        (row) => row.content_hash === document.content_hash,
      );
      expect(rows.map((row) => row.id)).toEqual([document.id]);
    });

    test("the same bytes from a second folder are the same document, and one copy", async () => {
      const first = writeFixture("same-a.pdf", SAME_IN_TWO_FOLDERS);
      const second = writeFixture("same-b.pdf", SAME_IN_TWO_FOLDERS);

      const imported = await importDocument(first);
      const copiesBefore = copiesInLibrary().length;

      const again = await importDocument(second);
      expect(again.id).toBe(imported.id);
      // The copy for those bytes already existed, so nothing new lands.
      expect(copiesInLibrary().length).toBe(copiesBefore);
      // The row still remembers the folder it was first imported from.
      expect(again.original_path).toBe(first);
    });

    test("different bytes are a different document", async () => {
      const first = await importDocument(writeFixture("diff-a.pdf", BOOK));
      const second = await importDocument(writeFixture("diff-b.pdf", OTHER));

      expect(second.id).not.toBe(first.id);
      expect(second.name).toBe("diff-b");
      expect(second.content_hash).not.toBe(first.content_hash);
    });

    test("several paths are copied into the library and returned in that order", async () => {
      const firstPath = writeFixture("multi-a.pdf", "%PDF-1.4\n%%EOF\n%multi a\n");
      const secondPath = writeFixture("multi-b.pdf", "%PDF-1.4\n%%EOF\n%multi b\n");
      const copiesBefore = copiesInLibrary().length;

      const documents = await importDocuments({ source_paths: [firstPath, secondPath] });

      expect(documents.map((document) => document.name)).toEqual(["multi-a", "multi-b"]);
      expect(documents[0]?.id).not.toBe(documents[1]?.id);
      expect(documents[0]?.original_path).toBe(firstPath);
      expect(documents[1]?.original_path).toBe(secondPath);
      for (const document of documents) {
        expect(document.file_path.startsWith(library())).toBe(true);
        expect(existsSync(document.file_path)).toBe(true);
        expect(readFileSync(document.file_path).toString()).toBe(
          document.original_path === firstPath
            ? "%PDF-1.4\n%%EOF\n%multi a\n"
            : "%PDF-1.4\n%%EOF\n%multi b\n",
        );
      }
      expect(copiesInLibrary().length).toBe(copiesBefore + 2);
      // Each new document is placed first, so the last path in the request is on top.
      expect(documents[1]?.ordering).toBe(0);
      expect(documents[0]?.ordering).toBe(1);
    });

    test("one bad path copies none of the batch", async () => {
      const good = writeFixture("batch-good.pdf", "%PDF-1.4\n%%EOF\n%batch good\n");
      const bad = writeFixture("batch-bad.txt", "not a pdf\n");
      const copiesBefore = copiesInLibrary().length;
      const idsBefore = (await listDocuments()).map((row) => row.id);

      const failure = (await importDocuments({ source_paths: [good, bad] }).catch(
        (error: unknown) => error,
      )) as { status?: unknown };

      expect(failure.status).toBe(400);
      expect(copiesInLibrary().length).toBe(copiesBefore);
      expect((await listDocuments()).map((row) => row.id)).toEqual(idsBefore);
    });

    test("a document written before the library is upgraded in place, notes and all", async () => {
      const source = writeFixture("legacy.pdf", LEGACY);
      const legacy = await resolveDocument({ file_path: source, name: "Old notes" });
      const strip = await createStrip({
        ...geometry,
        pdf_document_id: legacy.id,
        text_excerpt: "a passage written before the library existed",
      });

      const upgraded = await importDocument(source);

      expect(upgraded.id).toBe(legacy.id);
      expect(upgraded.file_path.startsWith(library())).toBe(true);
      expect(upgraded.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(upgraded.original_path).toBe(source);
      // The name and the notes belong to the document, not to the path it had.
      expect(upgraded.name).toBe("Old notes");
      expect(upgraded.notes.map((item) => item.id)).toEqual([strip.id]);
      // The old path no longer names a document.
      expect((await listDocuments()).filter((row) => row.file_path === source)).toEqual([]);

      // The reason for the copy: the notes survive the original going away.
      rmSync(source, { force: true });
      const reopened = await resolveDocument({ file_path: upgraded.file_path });
      expect(reopened.id).toBe(legacy.id);
      expect(reopened.notes.map((item) => item.id)).toEqual([strip.id]);

      await deleteStrip(strip.id);
    });

    test("a library path is answered as it is, without hashing it again", async () => {
      const source = writeFixture("fast-path.pdf", ORPHAN);
      const imported = await importDocument(source);

      const again = await importDocument(imported.file_path);
      expect(again.id).toBe(imported.id);
      expect(again.file_path).toBe(imported.file_path);
      expect(again.original_path).toBe(source);
    });

    test("a deleted library copy is restored from the original", async () => {
      const source = writeFixture("restore.pdf", RESTORED);
      const imported = await importDocument(source);
      rmSync(imported.file_path, { force: true });
      expect(existsSync(imported.file_path)).toBe(false);

      const again = await importDocument(source);
      expect(again.id).toBe(imported.id);
      expect(existsSync(imported.file_path)).toBe(true);
      expect(readFileSync(imported.file_path).toString()).toBe(RESTORED);
    });

    test("a file that is not a PDF is refused, and nothing is copied", async () => {
      const source = writeFixture("notes.txt", "not a PDF at all\n");
      const copiesBefore = copiesInLibrary().length;

      const failure = (await importDocument(source).catch((error: unknown) => error)) as {
        status?: unknown;
      };

      expect(failure.status).toBe(400);
      expect(copiesInLibrary().length).toBe(copiesBefore);
    });

    test("a path that does not exist is a 404", async () => {
      const failure = (await importDocument(join(fixtures, "missing.pdf")).catch(
        (error: unknown) => error,
      )) as { status?: unknown };
      expect(failure.status).toBe(404);
    });

    test("deleting a document removes its notes and the library copy, not the original", async () => {
      const source = writeFixture("to-delete.pdf", "%PDF-1.4\n%%EOF\n%gone\n");
      const document = await importDocument(source);
      await createStrip({
        ...geometry,
        pdf_document_id: document.id,
        text_excerpt: "goes away with the document",
      });
      expect(existsSync(document.file_path)).toBe(true);

      await deleteDocument(document.id);

      expect((await listDocuments()).some((row) => row.id === document.id)).toBe(false);
      expect(await listStrips({ pdf_document_id: document.id })).toEqual([]);
      expect(await listFolders(document.id)).toEqual([]);
      expect(existsSync(document.file_path)).toBe(false);
      expect(existsSync(source)).toBe(true);

      // The library copy is gone, so resolving that path must not bring the row back.
      const request = store.dispatch(
        pdfDocumentApi.endpoints.getOrCreateDocument.initiate(
          { file_path: document.file_path },
          { forceRefetch: true },
        ),
      );
      const gone = (await request.unwrap().catch((error: unknown) => error)) as { status?: unknown };
      request.unsubscribe();
      expect(gone.status).toBe(404);
      expect((await listDocuments()).some((row) => row.file_path === document.file_path)).toBe(false);

      const missing = (await deleteDocument(document.id).catch((error: unknown) => error)) as {
        status?: unknown;
      };
      expect(missing.status).toBe(404);
    });

    test("a refused delete keeps the row and the library copy", async () => {
      const source = writeFixture("kept.pdf", "%PDF-1.4\n%%EOF\n%kept\n");
      const document = await importDocument(source);
      await createStrip({
        ...geometry,
        pdf_document_id: document.id,
        text_excerpt: "still here",
      });

      const failure = (await deleteDocument(document.id).catch((error: unknown) => error)) as {
        status?: unknown;
      };

      expect(failure.status).toBe(400);
      expect((await listDocuments()).some((row) => row.id === document.id)).toBe(true);
      expect(existsSync(document.file_path)).toBe(true);
      expect(existsSync(source)).toBe(true);
    });

    test("deleting a document with no notes removes the library copy", async () => {
      const source = writeFixture("no-notes.pdf", "%PDF-1.4\n%%EOF\n%no notes\n");
      const document = await importDocument(source);
      expect(existsSync(document.file_path)).toBe(true);

      await deleteDocument(document.id);

      expect((await listDocuments()).some((row) => row.id === document.id)).toBe(false);
      expect(existsSync(document.file_path)).toBe(false);
      expect(existsSync(source)).toBe(true);
    });

    test("deleting down to one document selects that document", async () => {
      const survivor = await resolveDocument({
        file_path: "/tmp/pdf-focus-viewer-sole-survivor.pdf",
        name: "sole survivor",
      });
      const other = await resolveDocument({
        file_path: "/tmp/pdf-focus-viewer-other-to-drop.pdf",
        name: "other",
      });
      const beforeDelete = await listDocuments();
      expect(beforeDelete.length).toBeGreaterThan(2);
      expect((await getAppState()).last_opened_pdf_document_id).toBe(other.id);

      // Several documents are still in the library, so deleting one clears the
      // pointer when it was the last opened document and does not pick another.
      await deleteDocument(other.id);
      expect((await getAppState()).last_opened_pdf_document_id).toBeNull();
      expect((await listDocuments()).some((row) => row.id === survivor.id)).toBe(true);

      const extras = (await listDocuments()).filter((row) => row.id !== survivor.id);
      for (const row of extras) await deleteDocument(row.id);

      expect((await listDocuments()).map((row) => row.id)).toEqual([survivor.id]);
      expect((await getAppState()).last_opened_pdf_document_id).toBe(survivor.id);

      // The last document can still leave. Nothing remains to resolve.
      await deleteDocument(survivor.id);
      expect(await listDocuments()).toEqual([]);
      expect((await getAppState()).last_opened_pdf_document_id).toBeNull();
    });
  });

  /* ── domain pipeline ─────────────────────────────────────────
     The REST contract is unchanged; these tests look behind it at the audit
     rows and the flow graph the command bus produces. They run last, so the
     extra document they create does not affect the ordering assertions above. */

  describe("domain pipeline and audit trail", () => {
    const api = (path: string) => `http://127.0.0.1:${port}${path}`;

    const auditRowsFor = async (requestId: string) => {
      const database = createPrismaClient(databasePath as string);
      try {
        return await database.event_audit.findMany({
          where: { request_id: requestId },
          orderBy: { event_order: "asc" },
        });
      } finally {
        await database.$disconnect();
      }
    };

    const resolveAuditDocument = async () => {
      const filePath = "/tmp/pdf-focus-viewer-audit.pdf";
      if (!existsSync(filePath)) writeFileSync(filePath, "%PDF-1.4\n%%EOF\n");
      const response = await fetch(api("/pdf-documents/resolve"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file_path: filePath, name: "Audit" }),
      });
      expect(response.status).toBe(200);
      return responseData<{ id: number }>(response);
    };

    test("a command writes a command row and one row per event, under X-Request-Id", async () => {
      const document = await resolveAuditDocument();

      const response = await fetch(api("/notes"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pdf_document_id: document.id,
          page_number: 1,
          top: 10,
          height: 20,
          left: 5,
          width: 300,
          page_width: 600,
          page_height: 800,
          remark: "audited",
        }),
      });
      expect(response.status).toBe(201);

      const requestId = response.headers.get("x-request-id");
      expect(requestId).toBeTruthy();
      const strip = await responseData<{ id: number; note_folder_id: number | null }>(response);
      // The policy files the strip after the command returns, and the response
      // is the row after that, so the new strip is already in Notes.
      expect(strip.note_folder_id).toBeGreaterThan(0);

      const rows = await auditRowsFor(requestId as string);
      // The row carries no command/event discriminator any more; the order is
      // what says which is which, with the command first and its events after.
      // A document with no folder yet follows the strip event with the policy's
      // nested commands: open Notes, then file the strip into it.
      expect(rows.map((row) => [row.event_type, row.success])).toEqual([
        ["CreateNoteCommand", true],
        ["NoteCreatedEvent", true],
        ["HistoryUndoRedoReadyEvent", true],
        ["CreateNoteFolderCommand", true],
        ["NoteFolderCreatedEvent", true],
        ["AssignNoteFolderCommand", true],
        ["NoteFolderAssignedEvent", true],
      ]);
      expect(rows.map((row) => row.event_order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(rows[0]?.payload).toContain(`"pdf_document_id":${document.id}`);
      expect(rows[1]?.payload).toContain(`"folderId":null`);
      expect(rows[4]?.payload).toContain(`"name":"Notes"`);
      expect(rows[4]?.payload).toContain(`"documentId":${document.id}`);
      expect(rows[0]?.request_user_email).toBeNull();
      expect(rows[0]?.failure_reason).toBe("");

      // A later strip reuses that folder, so the policy does not open another.
      const again = await fetch(api("/notes"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pdf_document_id: document.id,
          page_number: 1,
          top: 40,
          height: 20,
          left: 5,
          width: 300,
          page_width: 600,
          page_height: 800,
        }),
      });
      expect(again.status).toBe(201);
      const againId = again.headers.get("x-request-id");
      expect(againId).toBeTruthy();
      const againStrip = await responseData<{ id: number }>(again);
      const againRows = await auditRowsFor(againId as string);
      expect(againRows.map((row) => row.event_type)).toEqual([
        "CreateNoteCommand",
        "NoteCreatedEvent",
        "HistoryUndoRedoReadyEvent",
      ]);

      await fetch(api(`/notes/${strip.id}`), { method: "DELETE" });
      await fetch(api(`/notes/${againStrip.id}`), { method: "DELETE" });
    });

    test("a failed command leaves a failure row and no event row", async () => {
      const response = await fetch(api("/notes"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pdf_document_id: 999_999,
          page_number: 1,
          top: 10,
          height: 20,
          left: 5,
          width: 300,
          page_width: 600,
          page_height: 800,
        }),
      });
      expect(response.status).toBe(404);

      const requestId = response.headers.get("x-request-id");
      expect(requestId).toBeTruthy();
      const rows = await auditRowsFor(requestId as string);

      // One row, and it is the command's: order 0 is the front of the batch,
      // where a failed command leaves its record and its events never follow.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.event_order).toBe(0);
      expect(rows[0]?.event_type).toBe("CreateNoteCommand");
      expect(rows[0]?.success).toBe(false);
      expect(rows[0]?.failure_reason).toContain("does not exist");
    });

    test("the event audit endpoint returns the recorded rows", async () => {
      const response = await fetch(api("/event-audit?limit=5&sortOrder=desc"));
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        success: boolean;
        data?: { events: unknown[]; total: number };
      };
      expect(body.success).toBe(true);
      expect(body.data?.events.length).toBeGreaterThan(0);
      expect(body.data?.total).toBeGreaterThan(0);
    });

    test("the flow endpoint describes the whole graph", async () => {
      const response = await fetch(api("/docs/commands"));
      expect(response.status).toBe(200);

      const flow = await responseData<{
        commands: {
          name: string;
          handler: string;
          context: string;
          transaction: string;
          emits: string[];
          payload: Record<string, string>;
        }[];
        queries: { name: string; context: string; payload: Record<string, string> }[];
        policies: { name: string; listensTo: string[]; sends: string[] }[];
        events: { name: string; context: string; payload: Record<string, string> }[];
        invariants: { component: string; method: string; rules: string[] }[];
        dtos: Record<string, Record<string, string>>;
      }>(response);

      expect(flow.commands).toHaveLength(39);
      expect(flow.queries).toHaveLength(8);
      // One strip by id is a query of its own: a `[note:<id>]` reference in
      // another note resolves through it, not through a filtered list.
      expect(
        flow.queries.find((query) => query.name === "GetNoteQuery")?.payload,
      ).toEqual({ id: "number" });
      // Every node is owned by exactly one context: the notes, the tag
      // catalogue, and the session history the other two write into.
      expect(
        [
          ...new Set(
            [...flow.commands, ...flow.queries, ...flow.events].map((node) => node.context),
          ),
        ].sort(),
      ).toEqual(
        [
          CONTEXT_HISTORY_MANAGEMENT,
          CONTEXT_PDF_NOTES_MANAGEMENT,
          CONTEXT_PDF_TAG_MANAGEMENT,
        ].sort(),
      );
      // The stack's own command and events belong to the history context, even
      // though the note and tag handlers are the ones that announce a step.
      expect(
        flow.commands.find((command) => command.name === "ApplyHistoryCommand")?.context,
      ).toBe(CONTEXT_HISTORY_MANAGEMENT);
      expect(
        flow.events
          .filter((event) => event.name.startsWith("History"))
          .map((event) => [event.name, event.context]),
      ).toEqual([
        ["HistoryAppliedEvent", CONTEXT_HISTORY_MANAGEMENT],
        ["HistoryUndoRedoReadyEvent", CONTEXT_HISTORY_MANAGEMENT],
      ]);
      expect(
        flow.commands.find((command) => command.name === "CreateNoteCommand"),
      ).toMatchObject({
        handler: "CreateNoteCommandHandler",
        context: CONTEXT_PDF_NOTES_MANAGEMENT,
        emits: ["NoteCreatedEvent", "HistoryUndoRedoReadyEvent"],
      });
      // The development event log is excluded from the graph. Saving a strip
      // with no folder makes PdfPolicy open a Notes folder and file the strip.
      // Resolving a document sends UpdateAppStateCommand so the settings row
      // remembers that document, unless the resolve opened it in a new window.
      // Deleting down to one document sends
      // ResolvePdfDocumentCommand, which is how that remaining document gets
      // selected. HistoryPolicy is the only writer of the shared stack, and
      // PdfTagPolicy takes a deleted document's assignments with it.
      expect(flow.policies).toEqual([
        {
          name: "HistoryPolicy",
          listensTo: ["HistoryAppliedEvent", "HistoryUndoRedoReadyEvent"],
          sends: [],
          listeners: [
            {
              event: "HistoryUndoRedoReadyEvent",
              rules: ["A committed library command remembers the command that undoes it"],
              sends: [],
            },
            {
              event: "HistoryAppliedEvent",
              rules: ["Undo and redo move the step to the other stack"],
              sends: [],
            },
          ],
        },
        {
          name: "PdfDocumentFolderPolicy",
          listensTo: ["PdfDocumentFolderDeletedEvent"],
          sends: [],
          listeners: [
            {
              event: "PdfDocumentFolderDeletedEvent",
              rules: ["Only an empty document folder can be deleted"],
              sends: [],
            },
          ],
        },
        {
          name: "PdfPolicy",
          listensTo: [
            "NoteCreatedEvent",
            "NoteFolderDeletedEvent",
            "PdfDocumentDeletedEvent",
            "PdfDocumentResolvedEvent",
            "PdfLibraryCopyReleasedEvent",
          ],
          sends: [
            "AssignNoteFolderCommand",
            "CreateNoteFolderCommand",
            "ResolvePdfDocumentCommand",
            "UpdateAppStateCommand",
          ],
          listeners: [
            {
              event: "PdfDocumentResolvedEvent",
              rules: [
                "AppState should be adjusted after we resolved the filepath and opened it",
                "Opening a document in a new window does not change last_opened_pdf_document_id",
              ],
              sends: ["UpdateAppStateCommand"],
            },
            {
              event: "PdfDocumentDeletedEvent",
              rules: ["When a deletion leaves one PDF, that PDF is selected"],
              sends: ["ResolvePdfDocumentCommand"],
            },
            {
              event: "NoteFolderDeletedEvent",
              rules: ["Nonempty folder (still with notes) cannot be deleted"],
              sends: [],
            },
            {
              event: "PdfDocumentDeletedEvent",
              rules: ["Nonempty pdf (still with notes) cannot be deleted"],
              sends: [],
            },
            {
              event: "PdfLibraryCopyReleasedEvent",
              rules: [
                "A committed deletion parks the library copy in the trash and leaves the reader's own file",
              ],
              sends: [],
            },
            {
              event: "NoteCreatedEvent",
              rules: ["A strip saved with no folder opens a Notes folder and sits in it"],
              sends: ["AssignNoteFolderCommand", "CreateNoteFolderCommand"],
            },
          ],
        },
        {
          name: "PdfTagPolicy",
          listensTo: ["PdfDocumentDeletedEvent", "PdfTagDeletedEvent", "PdfTagFolderDeletedEvent"],
          sends: ["DeleteAssignedPdfTagsCommand"],
          listeners: [
            {
              event: "PdfTagFolderDeletedEvent",
              rules: ["Only an empty tag folder can be deleted"],
              sends: [],
            },
            {
              event: "PdfTagDeletedEvent",
              rules: ["Only an unused tag can be deleted"],
              sends: [],
            },
            {
              event: "PdfDocumentDeletedEvent",
              rules: ["A deleted document takes its tag assignments with it"],
              sends: ["DeleteAssignedPdfTagsCommand"],
            },
          ],
        },
      ]);
      expect(flow.events.map((event) => event.name)).toContain("NoteCreatedEvent");
      expect(
        flow.commands.find((command) => command.name === "ImportPdfDocumentCommand")?.transaction,
      ).toBe("required");
      // Invariants are policy-listener metadata, listed by component and then
      // method. HistoryPolicy keeps one stack. PdfPolicy refuses a folder or a
      // document that still has notes, records the resolved document, and
      // leaves that record alone when the resolve opened a new window.
      // PdfTagPolicy refuses a non-empty folder or a tag still in use and takes
      // a deleted document's assignments with it. The development log is
      // excluded from the graph.
      expect(flow.invariants.map(({ component, method }) => ({ component, method }))).toEqual([
        { component: "HistoryPolicy", method: "onHistoryApplied" },
        { component: "HistoryPolicy", method: "onHistoryUndoRedoReady" },
        { component: "PdfDocumentFolderPolicy", method: "onPdfDocumentFolderDeleted" },
        { component: "PdfPolicy", method: "onLibraryCopyReleased" },
        { component: "PdfPolicy", method: "onNoteCreated" },
        { component: "PdfPolicy", method: "onNoteFolderDeleted" },
        { component: "PdfPolicy", method: "onPdfDeleted" },
        { component: "PdfPolicy", method: "onPdfDocumentDeleted" },
        { component: "PdfPolicy", method: "onPdfDocumentResolved" },
        { component: "PdfTagPolicy", method: "onPdfDocumentDeleted" },
        { component: "PdfTagPolicy", method: "onPdfTagDeleted" },
        { component: "PdfTagPolicy", method: "onPdfTagFolderDeleted" },
      ]);
      expect(flow.invariants[0]?.rules).toHaveLength(1);

      // Payloads are declared with `@Payload(...)` on the command/event classes:
      // JavaScript erases constructor types, so the diagram cannot read them.
      // Body-schema commands derive theirs from the Zod schema the route uses.
      expect(
        flow.commands.find((command) => command.name === "CreateNoteCommand")?.payload,
      ).toMatchObject({
        pdf_document_id: "number",
        page_number: "number",
        height: "number",
      });
      expect(
        flow.commands.find((command) => command.name === "RenameNoteFolderCommand")?.payload,
      ).toEqual({ id: "number", name: "string" });
      expect(flow.events.find((event) => event.name === "NoteFolderRenamedEvent")?.payload).toEqual({
        folderId: "number",
        documentId: "number",
        name: "string",
      });
      // Every card carries a payload: at least one field, or an empty map for
      // classes that take none (GetAppStateQuery).
      expect(flow.commands.every((command) => Object.keys(command.payload).length > 0)).toBe(true);
      expect(flow.events.every((event) => Object.keys(event.payload).length > 0)).toBe(true);
      // Nested shapes named by a payload type are gathered for expansion.
      expect(Object.keys(flow.dtos)).toEqual(
        expect.arrayContaining(["UpdateStripBody", "ReorderGroup", "NoteFilter"]),
      );
      expect(flow.dtos.UpdateStripBody).toMatchObject({ "page_number?": "number" });
    });

    test("the command-flow endpoint opens the diagram and is documented", async () => {
      // A browser navigating to the route is sent to the page the backend serves.
      const browser = await fetch(api("/docs/command-flow"), {
        headers: { Accept: "text/html" },
        redirect: "manual",
      });
      expect(browser.status).toBe(302);
      expect(browser.headers.get("location")).toBe("/event-storming/");

      // Every other client gets the pointers instead, which is the body the
      // Swagger UI shows for this operation.
      const response = await fetch(api("/docs/command-flow"), {
        headers: { Accept: "application/json" },
      });
      expect(response.status).toBe(200);

      const pointer = await responseData<{
        page: string;
        pageUrl: string;
        flow: string;
        built: boolean;
        hint?: string;
      }>(response);
      expect(pointer.page).toBe("/event-storming/");
      expect(pointer.pageUrl).toBe(`http://127.0.0.1:${port}/event-storming/`);
      expect(pointer.flow).toBe("/docs/commands");
      // Whether the bundle has been built is machine state, not an API promise:
      // `yarn dev` builds it, a fresh clone has not. Both answers are valid, and
      // the hint only appears when it is missing.
      expect(typeof pointer.built).toBe("boolean");
      expect(pointer.hint === undefined || pointer.built === false).toBe(true);

      // The endpoint has to be reachable *and documented*: this is the part the
      // Swagger UI reads.
      const document = (await (await fetch(api("/api-docs.json"))).json()) as {
        info: { description?: string };
        paths: Record<
          string,
          {
            get?: {
              summary?: string;
              description?: string;
              externalDocs?: { url: string; description?: string };
              responses?: Record<string, unknown>;
            };
          }
        >;
      };
      const operation = document.paths["/docs/command-flow"]?.get;
      expect(operation?.summary).toContain("event-storming diagram");
      expect(operation?.description).toContain("redirected");
      expect(Object.keys(operation?.responses ?? {})).toEqual(["200", "302"]);

      // Both links are what the Swagger UI renders as a clickable hyperlink: the
      // banner at the top of the page, and the operation's "External Docs".
      expect(document.info.description).toContain("(/event-storming/)");
      expect(operation?.description).toContain("(/event-storming/)");
      expect(operation?.externalDocs).toEqual({
        url: "/event-storming/",
        description: "Open the event-storming diagram",
      });
    });
  });

  /* ── undo and redo on the page ───────────────────────────────
     A highlight is stored on the document, and the pages paint it from
     `getHighlights` — a query of its own, tagged per document. These tests read
     that query's cache entry, because that is what the reader sees: an undo that
     restores the rows but not the page is not an undo. */

  describe("undo and redo of a highlight", () => {
    /** The mark list the pages are painting, read off the cache entry they subscribe to. */
    const painted = (id: number): string | undefined => {
      const state = store.getState() as unknown as {
        api: { queries: Record<string, { data?: unknown } | undefined> };
      };
      const entry = state.api.queries[`getHighlights(${id})`];
      return typeof entry?.data === "string" ? entry.data : undefined;
    };

    /** Wait for the refetch an invalidation starts to land in the cache. */
    const paintedBecomes = async (id: number, expected: string): Promise<void> => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && painted(id) !== expected) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(painted(id)).toBe(expected);
    };

    const undo = () => store.dispatch(historyApi.endpoints.undo.initiate()).unwrap();
    const redo = () => store.dispatch(historyApi.endpoints.redo.initiate()).unwrap();
    const replace = (id: number, highlights: string) =>
      store.dispatch(pdfDocumentApi.endpoints.replaceHighlights.initiate({ id, highlights })).unwrap();

    test("a stroke added to the page comes off and back on", async () => {
      const document = await resolveDocument({
        file_path: "/tmp/api-test-highlights.pdf",
        name: "marked",
      });
      const stroke = JSON.stringify([{ page: 1, x0: 12, x1: 180, y: 40, size: 16 }]);
      // A page mounts this query. Subscribing is what makes an invalidation
      // refetch it, the same way a mounted page does.
      const page = store.dispatch(pdfDocumentApi.endpoints.getHighlights.initiate(document.id));
      try {
        await page.unwrap();
        expect(painted(document.id)).toBe("[]");

        await replace(document.id, stroke);
        await paintedBecomes(document.id, stroke);

        const undone = await undo();
        expect(undone.label).toBe("Highlight");
        expect(undone.canRedo).toBe(true);
        await paintedBecomes(document.id, "[]");

        const redone = await redo();
        expect(redone.label).toBe("Highlight");
        await paintedBecomes(document.id, stroke);
      } finally {
        page.unsubscribe();
      }
    }, 15_000);

    test("a stroke deleted from the page is put back by undo", async () => {
      // Its own document and its own mark, so this case does not depend on how
      // the one above left the stack.
      const document = await resolveDocument({
        file_path: "/tmp/api-test-highlights-erased.pdf",
        name: "erased",
      });
      const stroke = JSON.stringify([{ page: 2, x0: 40, x1: 220, y: 90, size: 12 }]);
      const page = store.dispatch(pdfDocumentApi.endpoints.getHighlights.initiate(document.id));
      try {
        await page.unwrap();
        // A mark is on the page, then taken off with the same write a delete makes.
        await replace(document.id, stroke);
        await paintedBecomes(document.id, stroke);
        await replace(document.id, "[]");
        await paintedBecomes(document.id, "[]");

        await undo();
        await paintedBecomes(document.id, stroke);
      } finally {
        page.unsubscribe();
      }
    }, 15_000);

    test("a stroke drawn on a note card comes off the page with undo", async () => {
      // A card is the other way in: it writes its page's list through the strip,
      // and the page paints the document's list. One undo has to move both.
      const document = await resolveDocument({
        file_path: "/tmp/api-test-highlights-card.pdf",
        name: "card marked",
      });
      const strip = await createStrip({
        pdf_document_id: document.id,
        page_number: 1,
        top: 100,
        height: 20,
        left: 40,
        width: 300,
        page_width: 595,
        page_height: 842,
      });
      const cardStroke = JSON.stringify([{ x0: 40, x1: 300, y: 100, size: 16 }]);
      const pageStroke = JSON.stringify([{ page: 1, x0: 40, x1: 300, y: 100, size: 16 }]);
      const page = store.dispatch(pdfDocumentApi.endpoints.getHighlights.initiate(document.id));
      try {
        await page.unwrap();
        expect(painted(document.id)).toBe("[]");

        const marked = await updateStrip({ id: strip.id, highlights: cardStroke });
        expect(marked.highlights).toBe(cardStroke);
        await paintedBecomes(document.id, pageStroke);

        await undo();
        await paintedBecomes(document.id, "[]");
      } finally {
        page.unsubscribe();
      }
    }, 15_000);
  });

  describe("annotations", () => {
    test("a pin is created, read back with its document, and listed per document", async () => {
      const document = await resolveDocument({
        file_path: "/tmp/api-test-annotated.pdf",
        name: "annotated",
      });

      const created = await createAnnotation(document.id, {
        page_number: 3,
        x: 120.5,
        y: 640,
        text: "  the argument turns here  ",
      });
      expect(created.text).toBe("the argument turns here");
      expect(created.page_number).toBe(3);
      expect(created.pdf_document_id).toBe(document.id);

      const read = await getAnnotation(created.id);
      expect(read.pdf_document.id).toBe(document.id);
      expect(read.pdf_document.file_path).toBe(document.file_path);

      const listed = await listAnnotations(document.id);
      expect(listed.map((row) => row.id)).toEqual([created.id]);
    }, 15_000);

    test("a strip's preview is handed only the pins on its own page", async () => {
      const document = await resolveDocument({
        file_path: "/tmp/api-test-annotated-page.pdf",
        name: "annotated page",
      });
      const onPageTwo = await createAnnotation(document.id, {
        page_number: 2,
        x: 30,
        y: 40,
        text: "page two",
      });
      await createAnnotation(document.id, {
        page_number: 4,
        x: 50,
        y: 60,
        text: "page four",
      });
      const strip = await createStrip({
        pdf_document_id: document.id,
        page_number: 2,
        top: 100,
        height: 20,
        left: 40,
        width: 300,
        page_width: 595,
        page_height: 842,
      });

      const [card] = await listStrips({ pdf_document_id: document.id });
      expect(card?.annotations).toBe(
        JSON.stringify([
          { id: onPageTwo.id, x: 30, y: 40, width: 150, font_size: 9, text: "page two" },
        ]),
      );
      // The other list a preview paints is still there.
      expect(card?.highlights).toBe("[]");
      expect(strip.id).toBe(card?.id);
    }, 15_000);

    test("a pin's writing has a type size of its own, through the route", async () => {
      const document = await resolveDocument({
        file_path: "/tmp/api-test-annotation-type.pdf",
        name: "annotation type",
      });
      const created = await createAnnotation(document.id, {
        page_number: 1,
        x: 10,
        y: 10,
        text: "size me",
      });
      // A pin created without a size is written in the default the page draws.
      expect(created.font_size).toBe(9);

      const bigger = await setAnnotationFontSize(created.id, 12);
      expect(bigger.font_size).toBe(12);
      // The row holds it, not only the answer: every surface reads it back from here.
      expect((await getAnnotation(created.id)).font_size).toBe(12);

      // The body schema is the bound the menu also respects.
      await expect(setAnnotationFontSize(created.id, 40)).rejects.toMatchObject({ status: 400 });
      expect((await getAnnotation(created.id)).font_size).toBe(12);

      // A pin may also be created at a size of the reader's choosing.
      const chosen = await createAnnotation(document.id, {
        page_number: 1,
        x: 20,
        y: 20,
        font_size: 12,
        text: "chosen from the start",
      });
      expect(chosen.font_size).toBe(12);
    }, 15_000);

    test("the text is retyped in place, and a delete is undone under the same id", async () => {
      const document = await resolveDocument({
        file_path: "/tmp/api-test-annotated-edit.pdf",
        name: "annotated edit",
      });
      const created = await createAnnotation(document.id, {
        page_number: 1,
        x: 10,
        y: 10,
        text: "first draft",
      });

      const updated = await updateAnnotationText(created.id, " second draft ");
      expect(updated.text).toBe("second draft");
      expect(updated.id).toBe(created.id);
      expect(updated.x).toBe(created.x);

      await deleteAnnotation(created.id);
      await expect(getAnnotation(created.id)).rejects.toMatchObject({ status: 404 });

      const undone = await store.dispatch(historyApi.endpoints.undo.initiate()).unwrap();
      expect(undone.label).toBe("Delete annotation");
      const restored = await getAnnotation(created.id);
      expect(restored.text).toBe("second draft");
      expect(restored.created_at).toBe(created.created_at);

      // And a reference already pasted into a note keeps resolving.
      expect((await listAnnotations(document.id)).map((row) => row.id)).toEqual([created.id]);
    }, 15_000);

    test("a move writes the page and the point, and undo puts the pin back", async () => {
      const document = await resolveDocument({
        file_path: "/tmp/api-test-annotated-move.pdf",
        name: "annotated move",
      });
      const created = await createAnnotation(document.id, {
        page_number: 2,
        x: 12,
        y: 34,
        text: "this line, not that one",
      });

      const moved = await moveAnnotation(created.id, 7, 200.5, 640);
      expect(moved.page_number).toBe(7);
      expect(moved.x).toBe(200.5);
      expect(moved.y).toBe(640);
      // A move is not a retype.
      expect(moved.text).toBe("this line, not that one");

      const undone = await store.dispatch(historyApi.endpoints.undo.initiate()).unwrap();
      expect(undone.label).toBe("Move annotation");
      const back = await getAnnotation(created.id);
      expect([back.page_number, back.x, back.y]).toEqual([2, 12, 34]);

      // Half a placement is not a place: the route refuses it.
      await expect(
        store
          .dispatch(annotationApi.endpoints.updateAnnotation.initiate({ id: created.id, page_number: 3 }))
          .unwrap(),
      ).rejects.toMatchObject({ status: 400 });
    }, 15_000);

    test("a move lands in the cache before the server answers, and rolls back on refusal", async () => {
      const document = await resolveDocument({
        file_path: "/tmp/api-test-annotated-optimistic.pdf",
        name: "annotated optimistic",
        page_count: 5,
      });
      const created = await createAnnotation(document.id, {
        page_number: 1,
        x: 10,
        y: 20,
        text: "optimistic",
      });

      /** The row as the cached list has it — what a page paints. */
      const cached = () =>
        annotationApi.endpoints.listDocumentAnnotations.select(document.id)(store.getState()).data?.find(
          (row) => row.id === created.id,
        );

      const subscription = store.dispatch(
        annotationApi.endpoints.listDocumentAnnotations.initiate(document.id),
      );
      try {
        await subscription.unwrap();
        expect(cached()).toMatchObject({ page_number: 1, x: 10, y: 20 });

        // Dispatched and not awaited: the cache must already be at the new place,
        // because the pin is drawn from it and a drag may not wait for a round trip.
        const move = store.dispatch(
          annotationApi.endpoints.updateAnnotation.initiate({
            id: created.id,
            documentId: document.id,
            page_number: 3,
            x: 120,
            y: 340,
          }),
        );
        expect(cached()).toMatchObject({ page_number: 3, x: 120, y: 340 });
        await move.unwrap();
        expect(cached()).toMatchObject({ page_number: 3, x: 120, y: 340 });

        // A refused write is undone: the pin goes back to the row it still has.
        const refused = store.dispatch(
          annotationApi.endpoints.updateAnnotation.initiate({
            id: created.id,
            documentId: document.id,
            page_number: 99,
            x: 1,
            y: 2,
          }),
        );
        await expect(refused.unwrap()).rejects.toMatchObject({ status: 400 });
        expect(cached()).toMatchObject({ page_number: 3, x: 120, y: 340 });
      } finally {
        subscription.unsubscribe();
      }
    }, 15_000);

    test("the content has a width that the row keeps, and the cache takes it at once", async () => {
      const document = await resolveDocument({
        file_path: "/tmp/api-test-annotated-width.pdf",
        name: "annotated width",
      });
      const created = await createAnnotation(document.id, {
        page_number: 1,
        x: 20,
        y: 30,
        width: 320,
        text: "## a wide note",
      });
      expect(created.width).toBe(320);

      const subscription = store.dispatch(
        annotationApi.endpoints.listDocumentAnnotations.initiate(document.id),
      );
      try {
        await subscription.unwrap();
        const cached = () =>
          annotationApi.endpoints.listDocumentAnnotations
            .select(document.id)(store.getState())
            .data?.find((row) => row.id === created.id);

        // The drag of the content's edge is optimistic too: the cache takes the new
        // width before the write answers.
        const resize = store.dispatch(
          annotationApi.endpoints.updateAnnotation.initiate({
            id: created.id,
            documentId: document.id,
            width: 140,
          }),
        );
        expect(cached()?.width).toBe(140);
        await resize.unwrap();
        expect(cached()?.width).toBe(140);
        // A resize is not a retype.
        expect(cached()?.text).toBe("## a wide note");
      } finally {
        subscription.unsubscribe();
      }
    }, 15_000);

    test("a blank text and a page past the end are refused", async () => {
      const document = await resolveDocument({
        file_path: "/tmp/api-test-annotated-rules.pdf",
        name: "annotated rules",
        page_count: 4,
      });

      await expect(
        createAnnotation(document.id, { page_number: 1, x: 10, y: 10, text: "   " }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        createAnnotation(document.id, { page_number: 5, x: 10, y: 10, text: "past the end" }),
      ).rejects.toMatchObject({ status: 400 });
      expect(await listAnnotations(document.id)).toEqual([]);
    }, 15_000);

    test("deleting the document takes its pins with it", async () => {
      const document = await resolveDocument({
        file_path: "/tmp/api-test-annotated-delete.pdf",
        name: "annotated delete",
      });
      const created = await createAnnotation(document.id, {
        page_number: 1,
        x: 10,
        y: 10,
        text: "goes with the document",
      });

      await deleteDocument(document.id);
      await expect(getAnnotation(created.id)).rejects.toMatchObject({ status: 404 });
    }, 15_000);
  });

  describe("pdf tags", () => {
    test("folders group tags, assignment writes the junction, deletion cascades", async () => {
      const document = await resolveDocument({
        file_path: join(databaseDir!, "tagged.pdf"),
        name: "Tagged",
      });
      const folder = await store
        .dispatch(pdfTagApi.endpoints.createPdfTagFolder.initiate({ name: "Languages" }))
        .unwrap();
      const rust = await store
        .dispatch(
          pdfTagApi.endpoints.createPdfTag.initiate({ name: "Rust", pdf_tag_folder_id: folder.id }),
        )
        .unwrap();
      const go = await store
        .dispatch(pdfTagApi.endpoints.createPdfTag.initiate({ name: "Go" }))
        .unwrap();

      const assigned = await store
        .dispatch(
          pdfDocumentApi.endpoints.assignPdfTags.initiate({
            id: document.id,
            pdf_tag_ids: [rust.id, go.id],
          }),
        )
        .unwrap();
      // Catalogue order: the folder's tag first, the ungrouped one last.
      expect(assigned.map((tag) => tag.name)).toEqual(["Rust", "Go"]);

      const row = (await listDocuments()).find((entry) => entry.id === document.id);
      expect(row?.tags.map((tag) => tag.name)).toEqual(["Rust", "Go"]);

      // Assigning the same tags again changes nothing.
      await store
        .dispatch(
          pdfDocumentApi.endpoints.assignPdfTags.initiate({
            id: document.id,
            pdf_tag_ids: [rust.id, go.id],
          }),
        )
        .unwrap();
      const countOf = async (id: number) =>
        (await store
          .dispatch(pdfTagApi.endpoints.listPdfTags.initiate(undefined, { forceRefetch: true }))
          .unwrap()).find((tag) => tag.id === id)?.document_count;
      expect(await countOf(rust.id)).toBe(1);

      // A rename reaches the document list, because the rows embed the names.
      await store
        .dispatch(pdfTagApi.endpoints.updatePdfTag.initiate({ id: rust.id, name: "Rustacean" }))
        .unwrap();
      const renamed = (await listDocuments()).find((entry) => entry.id === document.id);
      expect(renamed?.tags.map((tag) => tag.name)).toContain("Rustacean");

      const remaining = await store
        .dispatch(
          pdfDocumentApi.endpoints.unassignPdfTags.initiate({
            id: document.id,
            pdf_tag_ids: [rust.id],
          }),
        )
        .unwrap();
      expect(remaining.map((tag) => tag.name)).toEqual(["Go"]);

      // Deleting the folder keeps its tag, now ungrouped.
      await store.dispatch(pdfTagApi.endpoints.deletePdfTagFolder.initiate(folder.id)).unwrap();
      const catalog = await store
        .dispatch(pdfTagApi.endpoints.listPdfTags.initiate(undefined, { forceRefetch: true }))
        .unwrap();
      expect(catalog.find((tag) => tag.id === rust.id)?.pdf_tag_folder_id).toBeNull();

      // Deleting the tag takes it off the document.
      await store.dispatch(pdfTagApi.endpoints.deletePdfTag.initiate(go.id)).unwrap();
      const afterDelete = (await listDocuments()).find((entry) => entry.id === document.id);
      expect(afterDelete?.tags).toEqual([]);
    }, 20_000);

    test("copy makes one document carry another's tags, replacing its own", async () => {
      const source = await resolveDocument({
        file_path: join(databaseDir!, "copy-source.pdf"),
        name: "Copy source",
      });
      const target = await resolveDocument({
        file_path: join(databaseDir!, "copy-target.pdf"),
        name: "Copy target",
      });
      const alpha = await store
        .dispatch(pdfTagApi.endpoints.createPdfTag.initiate({ name: "CopyAlpha" }))
        .unwrap();
      const beta = await store
        .dispatch(pdfTagApi.endpoints.createPdfTag.initiate({ name: "CopyBeta" }))
        .unwrap();
      const gamma = await store
        .dispatch(pdfTagApi.endpoints.createPdfTag.initiate({ name: "CopyGamma" }))
        .unwrap();
      await store
        .dispatch(pdfDocumentApi.endpoints.assignPdfTags.initiate({ id: source.id, pdf_tag_ids: [alpha.id] }))
        .unwrap();
      await store
        .dispatch(
          pdfDocumentApi.endpoints.assignPdfTags.initiate({
            id: target.id,
            pdf_tag_ids: [beta.id, gamma.id],
          }),
        )
        .unwrap();

      const tags = await store
        .dispatch(
          pdfDocumentApi.endpoints.copyPdfTags.initiate({
            id: target.id,
            from_document_id: source.id,
          }),
        )
        .unwrap();
      expect(tags.map((tag) => tag.name)).toEqual(["CopyAlpha"]);

      // The document list is what the rail shows, so it must agree.
      const row = (await listDocuments()).find((entry) => entry.id === target.id);
      expect(row?.tags.map((tag) => tag.name)).toEqual(["CopyAlpha"]);

      // An unknown source is refused, and the target keeps what it has.
      await expect(
        store
          .dispatch(
            pdfDocumentApi.endpoints.copyPdfTags.initiate({
              id: target.id,
              from_document_id: source.id + 999,
            }),
          )
          .unwrap(),
      ).rejects.toMatchObject({ status: 404 });
      const afterFailure = (await listDocuments()).find((entry) => entry.id === target.id);
      expect(afterFailure?.tags.map((tag) => tag.name)).toEqual(["CopyAlpha"]);
    }, 20_000);
  });
});
