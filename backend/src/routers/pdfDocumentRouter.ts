import { z } from "zod";
import { createDocRouter } from "../docs/routeRegistry.ts";
import { notFound, parseIdParam } from "../http.ts";
import { listFoldersWithStrips, listUnfiledStrips } from "../folders.ts";
import {
  ErrorResponse,
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

    const folders = await listFoldersWithStrips(req.db, document.id);
    res.json({
      ...document,
      // Folders in drag order, then the strips that are in no folder.
      focusable_strips: [
        ...folders.flatMap((folder) => folder.focusable_strips),
        ...(await listUnfiledStrips(req.db, document.id)),
      ],
    });
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

/** Last path segment without its extension, used when the client sends no name. */
function defaultNameFor(file_path: string): string {
  const fileName = file_path.split(/[\\/]/).pop() ?? file_path;
  const dotIndex = fileName.lastIndexOf(".");
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  return stem.length > 0 ? stem : fileName;
}
