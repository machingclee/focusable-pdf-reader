import { z } from "zod";
import { createDocRouter } from "../docs/routeRegistry.ts";
import { ImportPdfDocumentCommand } from "../bounded-contexts/pdf-note-management/command/ImportPdfDocumentCommand.ts";
import { RenamePdfDocumentCommand } from "../bounded-contexts/pdf-note-management/command/RenamePdfDocumentCommand.ts";
import { ResolvePdfDocumentCommand } from "../bounded-contexts/pdf-note-management/command/ResolvePdfDocumentCommand.ts";
import { ListPdfDocumentsQuery } from "../bounded-contexts/pdf-note-management/query/ListPdfDocumentsQuery.ts";
import { parseIdParam } from "../common/http.ts";
import {
  ErrorResponse,
  ImportDocumentBodySchema,
  PdfDocumentSchema,
  PdfDocumentWithCountSchema,
  PdfDocumentWithStripsSchema,
  RenameDocumentBodySchema,
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

/** Every document, newest first, with how many strips it has. */
pdfDocumentRouter.get(
  "/",
  {
    responseSchema: z.array(PdfDocumentWithCountSchema),
    summary: "List every opened PDF, newest first, with its strip count",
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
      500: { description: "Internal server error", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    res.json(await req.commandBus.send(new ResolvePdfDocumentCommand(req.body)));
  },
);

/** Copy a picked PDF into the library and answer with its document. */
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
    res.json(await req.commandBus.send(new ImportPdfDocumentCommand(req.body)));
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
    res.json(await req.commandBus.send(new RenamePdfDocumentCommand(id, req.body.name)));
  },
);
