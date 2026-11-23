import { z } from "zod";
import { createDocRouter } from "../docs/routeRegistry.ts";
import { DeletePdfDocumentCommand } from "../bounded-contexts/pdf-note-management/command/DeletePdfDocumentCommand.ts";
import { ImportPdfDocumentCommand } from "../bounded-contexts/pdf-note-management/command/ImportPdfDocumentCommand.ts";
import { RenamePdfDocumentCommand } from "../bounded-contexts/pdf-note-management/command/RenamePdfDocumentCommand.ts";
import { ReorderPdfDocumentsCommand } from "../bounded-contexts/pdf-note-management/command/ReorderPdfDocumentsCommand.ts";
import { ReplacePdfHighlightsCommand } from "../bounded-contexts/pdf-note-management/command/ReplacePdfHighlightsCommand.ts";
import { ResolvePdfDocumentCommand } from "../bounded-contexts/pdf-note-management/command/ResolvePdfDocumentCommand.ts";
import { GetPdfHighlightsQuery } from "../bounded-contexts/pdf-note-management/query/GetPdfHighlightsQuery.ts";
import { ListPdfDocumentsQuery } from "../bounded-contexts/pdf-note-management/query/ListPdfDocumentsQuery.ts";
import { parseIdParam } from "../common/http.ts";
import {
  ErrorResponse,
  ImportDocumentBodySchema,
  PdfDocumentSchema,
  PdfDocumentWithCountSchema,
  PdfDocumentWithStripsSchema,
  RenameDocumentBodySchema,
  ReplacePdfHighlightsBodySchema,
  ReorderPdfDocumentsBodySchema,
  ResolveDocumentBodySchema,
} from "../common/schemas.ts";

/**
 * `/pdf-documents` - one row per opened PDF file.
 *
 * The routes are controllers: they parse/validate and hand a command or query
 * to the bus. The handlers own the database work, the events and the audit
 * rows (see `src/contexts/pdfNoteManagement/commandhandler`).
 */
export const pdfDocumentRouter = createDocRouter("/pdf-documents");

/** Every document, in drag order, with how many strips it has. */
pdfDocumentRouter.get(
  "/",
  {
    responseSchema: z.array(PdfDocumentWithCountSchema),
    summary: "List every opened PDF, in drag order, with its strip count",
    tags: ["pdf-documents"],
  },
  async (req, res) => {
    res.json(await req.queryBus.send(new ListPdfDocumentsQuery()));
  },
);

/** Create or refresh a document and return it with its strips. */
pdfDocumentRouter.post(
  "/resolve",
  {
    bodySchema: ResolveDocumentBodySchema,
    responseSchema: PdfDocumentWithStripsSchema,
    summary: "Create or refresh a document, returning it with its strips",
    tags: ["pdf-documents"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      404: { description: "No file at file_path", schema: ErrorResponse },
      500: { description: "Internal server error", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    res.json(await req.commandBus.send(new ResolvePdfDocumentCommand(req.body)));
  },
);

/** Copy picked PDFs into the library and answer with their documents, in request order. */
pdfDocumentRouter.post(
  "/import",
  {
    bodySchema: ImportDocumentBodySchema,
    responseSchema: z.array(PdfDocumentWithStripsSchema),
    summary: "Copy one or more PDFs into the library and return the documents that own them",
    tags: ["pdf-documents"],
    responses: {
      400: { description: "A file is not a PDF, or the body does not match", schema: ErrorResponse },
      404: { description: "No file at one of the paths", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    res.json(await req.commandBus.send(new ImportPdfDocumentCommand(req.body)));
  },
);

/** Apply a drag of the notes document list. */
pdfDocumentRouter.post(
  "/reorder",
  {
    bodySchema: ReorderPdfDocumentsBodySchema,
    responseSchema: z.array(PdfDocumentWithCountSchema),
    summary: "Reorder the documents",
    tags: ["pdf-documents"],
    responses: {
      400: { description: "document_ids is not a permutation of every document", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    res.json(await req.commandBus.send(new ReorderPdfDocumentsCommand(req.body)));
  },
);

/** Rename a document. The id is in the path so this cannot be mistaken for a general patch. */
pdfDocumentRouter.patch(
  "/:id/rename",
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
    res.json(await req.commandBus.send(new RenamePdfDocumentCommand(id, req.body.name)));
  },
);

/** The yellow strokes on this document, on every page. */
pdfDocumentRouter.get(
  "/:id/highlights",
  {
    responseSchema: z.object({ highlights: z.string() }),
    summary: "The document's highlight marks",
    tags: ["pdf-documents"],
    responses: {
      404: { description: "No such document", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    const highlights = await req.queryBus.send(new GetPdfHighlightsQuery(id));
    res.json({ highlights });
  },
);

/** Replace the document's marks. The PDF owns them, so any open PDF can be marked. */
pdfDocumentRouter.patch(
  "/:id/highlights",
  {
    bodySchema: ReplacePdfHighlightsBodySchema,
    responseSchema: z.object({ highlights: z.string() }),
    summary: "Replace the document's highlight marks",
    tags: ["pdf-documents"],
    responses: {
      400: { description: "highlights is not the mark list", schema: ErrorResponse },
      404: { description: "No such document", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    const highlights = await req.commandBus.send(new ReplacePdfHighlightsCommand(id, req.body.highlights));
    res.json({ highlights });
  },
);

/**
 * Remove a document. Folders and strips cascade with the row, and the library
 * copy is removed with them. The file the reader originally opened is not.
 */
pdfDocumentRouter.delete(
  "/:id",
  {
    summary: "Delete a document and the notes stored on it",
    tags: ["pdf-documents"],
    responses: {
      204: { description: "Document deleted" },
      400: { description: "Invalid id", schema: ErrorResponse },
      404: { description: "No such document", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    await req.commandBus.send(new DeletePdfDocumentCommand(id));
    res.status(204).end();
  },
);
