import { z } from "zod";
import { createDocRouter } from "../docs/routeRegistry.ts";
import { AssignPdfDocumentsToFolderCommand } from "../bounded-contexts/pdf-document-folder-management/command/AssignPdfDocumentsToFolderCommand.ts";
import { CreatePdfDocumentFolderCommand } from "../bounded-contexts/pdf-document-folder-management/command/CreatePdfDocumentFolderCommand.ts";
import { DeletePdfDocumentFolderCommand } from "../bounded-contexts/pdf-document-folder-management/command/DeletePdfDocumentFolderCommand.ts";
import { RemovePdfDocumentsFromFolderCommand } from "../bounded-contexts/pdf-document-folder-management/command/RemovePdfDocumentsFromFolderCommand.ts";
import { RenamePdfDocumentFolderCommand } from "../bounded-contexts/pdf-document-folder-management/command/RenamePdfDocumentFolderCommand.ts";
import { ReorderPdfDocumentFolderMembersCommand } from "../bounded-contexts/pdf-document-folder-management/command/ReorderPdfDocumentFolderMembersCommand.ts";
import { ReorderPdfDocumentFoldersCommand } from "../bounded-contexts/pdf-document-folder-management/command/ReorderPdfDocumentFoldersCommand.ts";
import { ListPdfDocumentFoldersQuery } from "../bounded-contexts/pdf-document-folder-management/query/ListPdfDocumentFoldersQuery.ts";
import { parseIdParam } from "../common/http.ts";
import {
  CreatePdfDocumentFolderBodySchema,
  ErrorResponse,
  PdfDocumentFolderMembersBodySchema,
  PdfDocumentFolderSchema,
  RenamePdfDocumentFolderBodySchema,
  ReorderPdfDocumentFoldersBodySchema,
} from "../common/schemas.ts";

/**
 * `/pdf-document-folders` - named groups of documents in the Documents rail.
 *
 * A document with no membership is Ungrouped, which is not a row. One document
 * may sit in several folders. `/reorder` is declared before `/:id` so the word
 * is never read as a folder id.
 */
export const pdfDocumentFolderRouter = createDocRouter("/pdf-document-folders");

/** Every document folder, in drag order, with its document ids. */
pdfDocumentFolderRouter.get(
  "/",
  {
    responseSchema: z.array(PdfDocumentFolderSchema),
    summary: "List the document folders in drag order",
    tags: ["pdf-document-folders"],
  },
  async (req, res) => {
    res.json(await req.queryBus.send(new ListPdfDocumentFoldersQuery()));
  },
);

/** Append a document folder. */
pdfDocumentFolderRouter.post(
  "/",
  {
    bodySchema: CreatePdfDocumentFolderBodySchema,
    responseSchema: PdfDocumentFolderSchema,
    successStatus: 201,
    summary: "Create a document folder",
    tags: ["pdf-document-folders"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      409: { description: "A document folder with that name already exists", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    res.status(201).json(await req.commandBus.send(new CreatePdfDocumentFolderCommand(req.body)));
  },
);

/** Apply a drag of the document-folder list. */
pdfDocumentFolderRouter.post(
  "/reorder",
  {
    bodySchema: ReorderPdfDocumentFoldersBodySchema,
    responseSchema: z.array(PdfDocumentFolderSchema),
    summary: "Reorder the document folders",
    tags: ["pdf-document-folders"],
    responses: {
      400: {
        description: "pdf_document_folder_ids is not a permutation of every document folder",
        schema: ErrorResponse,
      },
    },
  },
  async (req, res) => {
    res.json(await req.commandBus.send(new ReorderPdfDocumentFoldersCommand(req.body)));
  },
);

/** Apply a drag of the documents inside one folder. */
pdfDocumentFolderRouter.post(
  "/:id/documents/reorder",
  {
    bodySchema: PdfDocumentFolderMembersBodySchema,
    responseSchema: PdfDocumentFolderSchema,
    summary: "Reorder the documents inside a document folder",
    tags: ["pdf-document-folders"],
    responses: {
      400: {
        description: "pdf_document_ids is not a permutation of this folder's documents",
        schema: ErrorResponse,
      },
      404: { description: "No such document folder", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    res.json(
      await req.commandBus.send(new ReorderPdfDocumentFolderMembersCommand(id, req.body.pdf_document_ids)),
    );
  },
);

/** File documents in a folder. Documents already in it are skipped. */
pdfDocumentFolderRouter.post(
  "/:id/documents",
  {
    bodySchema: PdfDocumentFolderMembersBodySchema,
    responseSchema: PdfDocumentFolderSchema,
    summary: "Assign documents to a document folder",
    tags: ["pdf-document-folders"],
    responses: {
      400: { description: "The body does not match, or a document does not exist", schema: ErrorResponse },
      404: { description: "No such document folder", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    res.json(await req.commandBus.send(new AssignPdfDocumentsToFolderCommand(id, req.body.pdf_document_ids)));
  },
);

/** Take documents out of one folder. The documents themselves stay. */
pdfDocumentFolderRouter.delete(
  "/:id/documents",
  {
    bodySchema: PdfDocumentFolderMembersBodySchema,
    responseSchema: PdfDocumentFolderSchema,
    summary: "Remove documents from a document folder",
    tags: ["pdf-document-folders"],
    responses: {
      400: { description: "The body does not match, or a document does not exist", schema: ErrorResponse },
      404: { description: "No such document folder", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    res.json(await req.commandBus.send(new RemovePdfDocumentsFromFolderCommand(id, req.body.pdf_document_ids)));
  },
);

/** Rename a document folder. */
pdfDocumentFolderRouter.patch(
  "/:id",
  {
    bodySchema: RenamePdfDocumentFolderBodySchema,
    responseSchema: PdfDocumentFolderSchema,
    summary: "Rename a document folder",
    tags: ["pdf-document-folders"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      404: { description: "No such document folder", schema: ErrorResponse },
      409: { description: "A document folder with that name already exists", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    res.json(await req.commandBus.send(new RenamePdfDocumentFolderCommand(id, req.body.name)));
  },
);

/**
 * Delete a document folder.
 *
 * Only an empty folder can go. One that still holds documents is refused, so
 * the documents do not silently fall back to Ungrouped.
 */
pdfDocumentFolderRouter.delete(
  "/:id",
  {
    summary: "Delete an empty document folder",
    tags: ["pdf-document-folders"],
    responses: {
      204: { description: "Document folder deleted" },
      400: {
        description: "Invalid id, or the folder still holds documents",
        schema: ErrorResponse,
      },
      404: { description: "No such document folder", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    await req.commandBus.send(new DeletePdfDocumentFolderCommand(id));
    res.status(204).end();
  },
);
