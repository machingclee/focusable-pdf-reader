/**
 * Integration test for the RTK Query endpoints against a real backend.
 *
 * It spawns `backend/src/index.ts` on a throwaway SQLite database and a random
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
import { libraryDirFor } from "../backend/src/library.ts";
import { apiErrorMessage } from "../src/store/api/baseApi";
import { appStateApi } from "../src/store/api/appStateApi";
import { focusableStripApi } from "../src/store/api/focusableStripApi";
import { folderApi } from "../src/store/api/folderApi";
import { pdfDocumentApi } from "../src/store/api/pdfDocumentApi";
import { setBackendTargetOverride } from "../src/store/api/targetOverride";
import { store } from "../src/store/store";
import type {
  FocusableStrip,
  ImportDocumentInput,
  NewStripInput,
  PdfDocumentWithStrips,
  StripFilter,
  UpdateStripInput,
} from "../src/types/dto";

const backendDir = resolve(import.meta.dir, "..", "backend");
const backendAvailable = existsSync(join(backendDir, "node_modules"));
const READY_PATTERN = /BACKEND_READY port=(\d+)/;

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
const resolveDocument = async (body: { file_path: string; name?: string; update_name?: boolean }) => {
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
    .dispatch(focusableStripApi.endpoints.listStrips.initiate(filter, { forceRefetch: true }))
    .unwrap();

const createStrip = (body: NewStripInput): Promise<FocusableStrip> =>
  store.dispatch(focusableStripApi.endpoints.createStrip.initiate(body)).unwrap();

const updateStrip = (body: UpdateStripInput) =>
  store.dispatch(focusableStripApi.endpoints.updateStrip.initiate(body)).unwrap();

const deleteStrip = (id: number) =>
  store.dispatch(focusableStripApi.endpoints.deleteStrip.initiate(id)).unwrap();

const listFolders = (pdfDocumentId: number) =>
  store
    .dispatch(
      folderApi.endpoints.listFolders.initiate({ pdf_document_id: pdfDocumentId }, { forceRefetch: true }),
    )
    .unwrap();

const createFolder = (pdfDocumentId: number, name: string) =>
  store.dispatch(folderApi.endpoints.createFolder.initiate({ pdf_document_id: pdfDocumentId, name })).unwrap();

const reorderFolders = (pdfDocumentId: number, folderIds: number[]) =>
  store
    .dispatch(
      folderApi.endpoints.reorderFolders.initiate({ pdf_document_id: pdfDocumentId, folder_ids: folderIds }),
    )
    .unwrap();

const reorderStrips = (pdfDocumentId: number, groups: { folder_id: number | null; strip_ids: number[] }[]) =>
  store.dispatch(focusableStripApi.endpoints.reorderStrips.initiate({ pdf_document_id: pdfDocumentId, groups })).unwrap();

const deleteFolder = (id: number, withStrips = false) =>
  store.dispatch(folderApi.endpoints.deleteFolder.initiate({ id, with_strips: withStrips })).unwrap();

const importDocument = (body: ImportDocumentInput) =>
  store.dispatch(pdfDocumentApi.endpoints.importDocument.initiate(body)).unwrap();

const getAppState = () =>
  store
    .dispatch(appStateApi.endpoints.getAppState.initiate(undefined, { forceRefetch: true }))
    .unwrap();

const setAppState = (key: string, value: string) =>
  store.dispatch(appStateApi.endpoints.setAppState.initiate({ key, value })).unwrap();

/** Resolve a document by path, returning the row the other tests use. */
async function seedDocument(): Promise<PdfDocumentWithStrips> {
  return resolveDocument({ file_path: "/tmp/api-test-document.pdf", name: "file name" });
}

async function startBackend(): Promise<number> {
  databaseDir = mkdtempSync(join(tmpdir(), "pdf-focus-viewer-api-test-"));
  databasePath = join(databaseDir, "database.db");
  const process_ = Bun.spawn([process.execPath, "src/index.ts"], {
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
    const health = (await response.json()) as { status: string; pid: number };
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
      "/app-state",
      "/app-state/:key",
      "/focusable-strips",
      "/focusable-strips/:id",
      "/focusable-strips/reorder",
      "/folders",
      "/folders/:id",
      "/folders/reorder",
      "/health",
      "/pdf-documents",
      "/pdf-documents/:id",
      "/pdf-documents/import",
      "/pdf-documents/resolve",
    ]);
    expect(Object.keys(doc.paths["/focusable-strips"] ?? {}).sort()).toEqual(["get", "post"]);
    expect(Object.keys(doc.paths["/focusable-strips/:id"] ?? {}).sort()).toEqual(["delete", "patch"]);
    expect(Object.keys(doc.paths["/focusable-strips/reorder"] ?? {}).sort()).toEqual(["post"]);
    expect(Object.keys(doc.paths["/folders"] ?? {}).sort()).toEqual(["get", "post"]);
    expect(Object.keys(doc.paths["/folders/:id"] ?? {}).sort()).toEqual(["delete", "patch"]);
    expect(Object.keys(doc.paths["/folders/reorder"] ?? {}).sort()).toEqual(["post"]);
    // Deleting a folder documents the flag that also deletes its strips.
    const folderDelete = doc.paths["/folders/:id"]?.delete as
      | { parameters?: { name: string; in: string; required: boolean }[] }
      | undefined;
    expect(folderDelete?.parameters).toEqual([
      { name: "with_strips", in: "query", required: false, schema: expect.anything() },
    ]);
    expect(Object.keys(doc.paths["/app-state"] ?? {}).sort()).toEqual(["get"]);
    expect(Object.keys(doc.paths["/app-state/:key"] ?? {}).sort()).toEqual(["put"]);
  });

  test("the Swagger UI page is served", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api-docs/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("swagger-ui");
  });

  test("an invalid body is rejected in the API's error envelope", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/focusable-strips`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pdf_document_id: 0 }),
    });

    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string; details?: unknown };
    expect(payload.error).toBe("Validation failed");
    expect(Array.isArray(payload.details)).toBe(true);
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
    expect(document.focusable_strips).toEqual([]);
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
    expect(strip.id).toBeGreaterThan(0);
    expect(strip.page_number).toBe(3);
    expect(strip.folder_id).toBeGreaterThan(0);
    expect(strip.ordering).toBe(0);
    // A strip names its document directly now that a folder is optional: it has
    // to be listable when it is in no folder at all.
    expect(strip.pdf_document_id).toBe(documentId);
    expect(typeof strip.created_at).toBe("number");

    const listed = await listStrips({ pdf_document_id: documentId });
    expect(listed.map((item) => item.id)).toEqual([strip.id]);
    expect(listed[0]?.pdf_document?.name).toBe("file name");

    // One row, two kinds of write: the note, then the geometry a resize sends.
    const noted = await updateStrip({ id: strip.id, remark: "changed" });
    expect(noted.remark).toBe("changed");
    expect(noted.top).toBe(120.5);

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
      remark: "changed",
    });

    const reopened = await resolveDocument({ file_path: "/tmp/api-test-document.pdf" });
    expect(reopened.focusable_strips.map((item) => item.id)).toEqual([strip.id]);

    await deleteStrip(strip.id);
    expect(await listStrips({ pdf_document_id: documentId })).toEqual([]);
  });

  test("documents are listed newest first with strip counts", async () => {
    const documents = await listDocuments();
    expect(documents.length).toBe(1);
    expect(documents[0]?.id).toBe(documentId);
    expect(documents[0]?._count?.focusable_strips).toBe(0);
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
    expect(home?.name).toBe("Strips");
    expect(home?.focusable_strips.map((strip) => strip.id)).toEqual([first.id, second.id]);

    const flipped = await reorderStrips(documentId, [
      { folder_id: home!.id, strip_ids: [second.id, first.id] },
    ]);
    expect(flipped[0]?.focusable_strips.map((strip) => strip.id)).toEqual([second.id, first.id]);
    expect(flipped[0]?.focusable_strips.map((strip) => strip.ordering)).toEqual([0, 1]);

    const later = await createFolder(documentId, "Later");
    const moved = await reorderStrips(documentId, [
      { folder_id: home!.id, strip_ids: [second.id] },
      { folder_id: later.id, strip_ids: [first.id] },
    ]);
    const byId = new Map(moved.map((folder) => [folder.id, folder]));
    expect(byId.get(home!.id)?.focusable_strips.map((strip) => strip.id)).toEqual([second.id]);
    expect(byId.get(later.id)?.focusable_strips.map((strip) => strip.folder_id)).toEqual([later.id]);

    const reordered = await reorderFolders(documentId, [later.id, home!.id]);
    expect(reordered.map((folder) => folder.id)).toEqual([later.id, home!.id]);
    expect(reordered.map((folder) => folder.ordering)).toEqual([0, 1]);

    // "No folder" is the group with a null id: moving `first` out of `later`
    // sends the emptied source and the unfiled destination.
    const unfiledMove = await reorderStrips(documentId, [
      { folder_id: later.id, strip_ids: [] },
      { folder_id: null, strip_ids: [first.id] },
    ]);
    expect(unfiledMove.find((folder) => folder.id === later.id)?.focusable_strips).toEqual([]);

    const unfiledOnly = await listStrips({ pdf_document_id: documentId, unfiled: true });
    expect(unfiledOnly.map((strip) => strip.id)).toEqual([first.id]);
    expect(unfiledOnly[0]?.folder_id).toBeNull();

    // A folder-less strip is still the document's strip: it is counted, and it
    // comes back when the viewer reopens the file.
    expect((await listDocuments())[0]?._count?.focusable_strips).toBe(2);
    const reopened = await resolveDocument({ file_path: "/tmp/api-test-document.pdf" });
    expect(reopened.focusable_strips.map((strip) => strip.id).sort()).toEqual([first.id, second.id].sort());

    // A group may only list the strips it already holds, so a request cannot
    // silently yank a strip out of a folder it does not name.
    const wrongHome = await fetch(`http://127.0.0.1:${port}/focusable-strips/reorder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groups: [{ folder_id: home!.id, strip_ids: [first.id] }] }),
    });
    expect(wrongHome.status).toBe(400);

    // ...and it can be filed again.
    await reorderStrips(documentId, [
      { folder_id: null, strip_ids: [] },
      { folder_id: later.id, strip_ids: [first.id] },
    ]);
    expect(
      (await listFolders(documentId)).find((folder) => folder.id === later.id)?.focusable_strips.map((strip) => strip.id),
    ).toEqual([first.id]);

    // A folder that still holds a strip is not removed with it.
    const blocked = await fetch(`http://127.0.0.1:${port}/folders/${later.id}`, { method: "DELETE" });
    expect(blocked.status).toBe(409);

    // `with_strips=true` is the deliberate form: the strips go with the folder.
    const doomed = await createFolder(documentId, "Doomed");
    const doomedStrip = await createStrip({ ...geometry, pdf_document_id: documentId, top: 150, folder_id: doomed.id });
    // Through the endpoint, so this also proves the flag is serialised onto the
    // query string the backend reads.
    await deleteFolder(doomed.id, true);
    const survivors = await listFolders(documentId);
    expect(survivors.map((folder) => folder.id)).not.toContain(doomed.id);
    expect(survivors.flatMap((folder) => folder.focusable_strips).map((strip) => strip.id)).not.toContain(
      doomedStrip.id,
    );

    // The flag is a flag: a value the API does not recognise is a 400, not a
    // silent "true" on a destructive call.
    const mistyped = await fetch(`http://127.0.0.1:${port}/folders/${later.id}?with_strips=1`, {
      method: "DELETE",
    });
    expect(mistyped.status).toBe(400);

    await deleteStrip(first.id);
    await deleteStrip(second.id);
    await deleteFolder(later.id);
    await deleteFolder(home!.id);
    expect(await listFolders(documentId)).toEqual([]);
  });

  test("app state round-trips and overwrites per key", async () => {
    expect(await getAppState()).toEqual({});

    await setAppState("notes_panel.width", "420");
    expect(await getAppState()).toEqual({ "notes_panel.width": "420" });

    // A second write is an upsert, and other keys are untouched.
    await setAppState("notes_panel.width", "512");
    await setAppState("other.flag", "on");
    expect(await getAppState()).toEqual({
      "notes_panel.width": "512",
      "other.flag": "on",
    });
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
      const document = await importDocument({ source_path: source });

      expect(document.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(document.original_path).toBe(source);
      expect(document.file_path.startsWith(library())).toBe(true);
      expect(document.file_path.endsWith(`${document.content_hash}.pdf`)).toBe(true);
      // The copy is the file, byte for byte, so the viewer reads the same PDF.
      expect(existsSync(document.file_path)).toBe(true);
      expect(readFileSync(document.file_path).toString()).toBe(BOOK);
      // The name comes from the original path, never from the hash.
      expect(document.name).toBe("book");
      expect(document.focusable_strips).toEqual([]);

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

      const imported = await importDocument({ source_path: first });
      const copiesBefore = copiesInLibrary().length;

      const again = await importDocument({ source_path: second });
      expect(again.id).toBe(imported.id);
      // The copy for those bytes already existed, so nothing new lands.
      expect(copiesInLibrary().length).toBe(copiesBefore);
      // The row still remembers the folder it was first imported from.
      expect(again.original_path).toBe(first);
    });

    test("different bytes are a different document", async () => {
      const first = await importDocument({ source_path: writeFixture("diff-a.pdf", BOOK) });
      const second = await importDocument({ source_path: writeFixture("diff-b.pdf", OTHER) });

      expect(second.id).not.toBe(first.id);
      expect(second.name).toBe("diff-b");
      expect(second.content_hash).not.toBe(first.content_hash);
    });

    test("a document written before the library is upgraded in place, notes and all", async () => {
      const source = writeFixture("legacy.pdf", LEGACY);
      const legacy = await resolveDocument({ file_path: source, name: "Old notes" });
      const strip = await createStrip({
        ...geometry,
        pdf_document_id: legacy.id,
        text_excerpt: "a passage written before the library existed",
      });

      const upgraded = await importDocument({ source_path: source });

      expect(upgraded.id).toBe(legacy.id);
      expect(upgraded.file_path.startsWith(library())).toBe(true);
      expect(upgraded.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(upgraded.original_path).toBe(source);
      // The name and the notes belong to the document, not to the path it had.
      expect(upgraded.name).toBe("Old notes");
      expect(upgraded.focusable_strips.map((item) => item.id)).toEqual([strip.id]);
      // The old path no longer names a document.
      expect((await listDocuments()).filter((row) => row.file_path === source)).toEqual([]);

      // The reason for the copy: the notes survive the original going away.
      rmSync(source, { force: true });
      const reopened = await resolveDocument({ file_path: upgraded.file_path });
      expect(reopened.id).toBe(legacy.id);
      expect(reopened.focusable_strips.map((item) => item.id)).toEqual([strip.id]);

      await deleteStrip(strip.id);
    });

    test("a library path is answered as it is, without hashing it again", async () => {
      const source = writeFixture("fast-path.pdf", ORPHAN);
      const imported = await importDocument({ source_path: source });

      const again = await importDocument({ source_path: imported.file_path });
      expect(again.id).toBe(imported.id);
      expect(again.file_path).toBe(imported.file_path);
      expect(again.original_path).toBe(source);
    });

    test("a deleted library copy is restored from the original", async () => {
      const source = writeFixture("restore.pdf", RESTORED);
      const imported = await importDocument({ source_path: source });
      rmSync(imported.file_path, { force: true });
      expect(existsSync(imported.file_path)).toBe(false);

      const again = await importDocument({ source_path: source });
      expect(again.id).toBe(imported.id);
      expect(existsSync(imported.file_path)).toBe(true);
      expect(readFileSync(imported.file_path).toString()).toBe(RESTORED);
    });

    test("a file that is not a PDF is refused, and nothing is copied", async () => {
      const source = writeFixture("notes.txt", "not a PDF at all\n");
      const copiesBefore = copiesInLibrary().length;

      const failure = (await importDocument({ source_path: source }).catch(
        (error: unknown) => error,
      )) as { status?: unknown };

      expect(failure.status).toBe(400);
      expect(copiesInLibrary().length).toBe(copiesBefore);
    });

    test("a path that does not exist is a 404", async () => {
      const failure = (await importDocument({
        source_path: join(fixtures, "missing.pdf"),
      }).catch((error: unknown) => error)) as { status?: unknown };
      expect(failure.status).toBe(404);
    });
  });
});
