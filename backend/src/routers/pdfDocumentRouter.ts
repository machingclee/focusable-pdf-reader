import { resolve } from "node:path";
import { z } from "zod";
import { createDocRouter } from "../docs/routeRegistry.ts";
import type { AppPrisma } from "../db.ts";
import type { pdf_document } from "../generated/prisma/client.ts";
import { badRequest, notFound, parseIdParam } from "../http.ts";
import { listFoldersWithStrips, listUnfiledStrips } from "../folders.ts";
import {
  copyIntoLibrary,
  hashFile,
  isExistingFile,
  isInsideDir,
  isPdfFile,
  libraryDir,
} from "../library.ts";
import {
  ErrorResponse,
  ImportDocumentBodySchema,
  PdfDocumentSchema,
  PdfDocumentWithCountSchema,
  PdfDocumentWithStripsSchema,
  RenameDocumentBodySchema,
  ResolveDocumentBodySchema,
} from "../schemas.ts";

/**
 * `/pdf-documents` - one row per opened PDF file.
 */
export const PDF_DOCUMENTS_MOUNT = "/pdf-documents";

export const pdfDocumentRouter = createDocRouter(PDF_DOCUMENTS_MOUNT);

/** Every document, newest first, with how many strips it has. */
pdfDocumentRouter.get(
  "/",
  {
    responseSchema: z.array(PdfDocumentWithCountSchema),
    summary: "List every opened PDF, newest first, with its strip count",
    tags: ["pdf-documents"],
  },
  async (req, res) => {
    const documents = await req.db.pdf_document.findMany({
      orderBy: { created_at: "desc" },
      // Strips hang off the document as well as off folders, so this counts the
      // folder-less ones too.
      include: { _count: { select: { focusable_strips: true } } },
    });
    res.json(documents);
  },
);

/**
 * Called every time a file is opened: create the document if the path is new,
 * otherwise refresh its metadata. Returns the document with all its strips so
 * the viewer can draw markers in one round trip.
 *
 * `name` is only written on update when `update_name: true` is sent, so a name
 * the user edited is not reset to the file name on the next open.
 */
pdfDocumentRouter.post(
  "/resolve",
  {
    bodySchema: ResolveDocumentBodySchema,
    responseSchema: PdfDocumentWithStripsSchema,
    summary: "Create or refresh a document, returning it with its strips",
    tags: ["pdf-documents"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      500: { description: "Internal server error", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const { file_path, name, fingerprint, page_count, update_name } = req.body;

    const document = await req.db.pdf_document.upsert({
      where: { file_path },
      create: {
        file_path,
        name: name && name.length > 0 ? name : defaultNameFor(file_path),
        fingerprint: fingerprint ?? null,
        page_count: page_count ?? null,
        created_at: Date.now(),
      },
      update: {
        ...(fingerprint === undefined ? {} : { fingerprint }),
        ...(page_count === undefined ? {} : { page_count }),
        ...(update_name && name ? { name } : {}),
      },
    });

    res.json(await withStrips(req.db, document));
  },
);

/**
 * Take a PDF the reader picked into the library, and answer with its document.
 *
 * This is the only way the app opens a file by path. The bytes are copied once
 * into `<app data>/library/<sha256>.pdf`, the row points at that copy, and every
 * later read — the viewer, the strip thumbnails, reopening from Recents — reads
 * the copy. Moving, renaming or deleting the original therefore changes nothing.
 *
 * The hash also makes the import idempotent: opening the same PDF from a second
 * folder finds the row by content and returns it, notes and all, instead of
 * creating a second one.
 */
pdfDocumentRouter.post(
  "/import",
  {
    bodySchema: ImportDocumentBodySchema,
    responseSchema: PdfDocumentWithStripsSchema,
    summary: "Copy a PDF into the library and return the document that owns it",
    tags: ["pdf-documents"],
    responses: {
      400: { description: "The file is not a PDF, or the body does not match", schema: ErrorResponse },
      404: { description: "No file at that path", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const { source_path, name } = req.body;

    // The reader can also be handed a library path — from Recents after a
    // restart, or from the Notes tab — and that copy is already the document's
    // own file, so there is nothing to copy and nothing to hash.
    if (isInsideDir(libraryDir(), source_path)) {
      const existing = await req.db.pdf_document.findUnique({
        where: { file_path: resolve(source_path) },
      });
      if (existing) {
        res.json(await withStrips(req.db, existing));
        return;
      }
      // The database was reset but the copies were kept: fall through, and the
      // hash below recreates the row for the file that is already there.
    }

    if (!(await isExistingFile(source_path))) throw notFound("The file does not exist");
    // The header, not the extension: this endpoint is given any local path, and
    // a renamed text file would otherwise land in the library and fail later in
    // pdf.js with a much less useful message.
    if (!(await isPdfFile(source_path))) throw badRequest("Not a PDF file");

    const hash = await hashFile(source_path);

    // Same bytes, already imported: the same document, wherever they were opened
    // from. The copy is (re)written because the reader may have deleted it.
    const byHash = await req.db.pdf_document.findUnique({ where: { content_hash: hash } });
    if (byHash) {
      await copyIntoLibrary(source_path, hash);
      res.json(await withStrips(req.db, byHash));
      return;
    }

    // A document written before the library existed: its notes are stored
    // against the reader's own path. Upgrading the row in place keeps its id, so
    // its folders, strips and notes come along untouched.
    //
    // The edge case is a legacy row for path A while the same content was already
    // imported from path B: the hash lookup above wins and answers B's document.
    // A's notes stay on A's row, which is still in the Notes tab. They are not
    // merged — two sets of notes for one book are the reader's business, not
    // something to resolve silently.
    const legacy = await req.db.pdf_document.findUnique({ where: { file_path: source_path } });
    if (legacy && legacy.content_hash === null) {
      const libraryPath = await copyIntoLibrary(source_path, hash);
      const updated = await req.db.pdf_document.update({
        where: { id: legacy.id },
        data: { file_path: libraryPath, content_hash: hash, original_path: source_path },
      });
      res.json(await withStrips(req.db, updated));
      return;
    }

    const libraryPath = await copyIntoLibrary(source_path, hash);
    const created = await req.db.pdf_document.create({
      data: {
        file_path: libraryPath,
        content_hash: hash,
        original_path: source_path,
        // The original path, never the library one: the name is what the reader
        // recognises the file by, and the copy is named by its hash.
        name: name && name.length > 0 ? name : defaultNameFor(source_path),
        fingerprint: null,
        page_count: null,
        created_at: Date.now(),
      },
    });
    res.json(await withStrips(req.db, created));
  },
);

/** Rename a document. */
pdfDocumentRouter.patch(
  "/:id",
  {
    bodySchema: RenameDocumentBodySchema,
    responseSchema: PdfDocumentSchema,
    summary: "Rename a document",
    tags: ["pdf-documents"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      404: { description: "No such document", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    const { name } = req.body;

    const existing = await req.db.pdf_document.findUnique({ where: { id } });
    if (!existing) throw notFound(`PDF document ${id} does not exist`);

    const document = await req.db.pdf_document.update({ where: { id }, data: { name } });
    res.json(document);
  },
);

/**
 * A document with every strip it owns, in the order the viewer draws them.
 *
 * Both routes that answer with a document use this: the viewer draws its note
 * badges from one round trip, so the shape has to be the same for an import as
 * for a resolve.
 */
async function withStrips(db: AppPrisma, document: pdf_document) {
  const folders = await listFoldersWithStrips(db, document.id);
  return {
    ...document,
    // Folders in drag order, then the strips that are in no folder.
    focusable_strips: [
      ...folders.flatMap((folder) => folder.focusable_strips),
      ...(await listUnfiledStrips(db, document.id)),
    ],
  };
}

/** Last path segment without its extension, used when the client sends no name. */
function defaultNameFor(file_path: string): string {
  const fileName = file_path.split(/[\\/]/).pop() ?? file_path;
  const dotIndex = fileName.lastIndexOf(".");
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  return stem.length > 0 ? stem : fileName;
}
