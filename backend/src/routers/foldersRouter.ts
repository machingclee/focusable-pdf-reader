import { z } from "zod";
import { createDocRouter } from "../docs/routeRegistry.ts";
import { CreateFolderCommand } from "../bounded-contexts/pdf-note-management/command/CreateFolderCommand.ts";
import { DeleteFolderCommand } from "../bounded-contexts/pdf-note-management/command/DeleteFolderCommand.ts";
import { RenameFolderCommand } from "../bounded-contexts/pdf-note-management/command/RenameFolderCommand.ts";
import { ReorderFoldersCommand } from "../bounded-contexts/pdf-note-management/command/ReorderFoldersCommand.ts";
import { ListFoldersWithStripsQuery } from "../bounded-contexts/pdf-note-management/query/ListFoldersWithStripsQuery.ts";
import {
  ErrorFactory,
  parseIdParam,
  parseOptionalQueryBoolean,
  parseOptionalQueryInt,
} from "../common/http.ts";
import {
  CreateFolderBodySchema,
  DeleteFolderQuerySchema,
  ErrorResponse,
  FolderSchema,
  FolderWithStripsSchema,
  FoldersQuerySchema,
  RenameFolderBodySchema,
  ReorderFoldersBodySchema,
} from "../common/schemas.ts";

/**
 * `/folders` - the named containers a document's strips are dragged between.
 *
 * A folder belongs to one document. Its `ordering` is its position in that
 * document; a strip's `ordering` is its position inside the folder.
 */
export const foldersRouter = createDocRouter("/folders");

/** The folders of one document, each with its strips, both in drag order. */
foldersRouter.get(
  "/",
  {
    querySchema: FoldersQuerySchema,
    responseSchema: z.array(FolderWithStripsSchema),
    summary: "List a document's folders and the strips inside them",
    tags: ["folders"],
    responses: { 400: { description: "Missing or invalid pdf_document_id", schema: ErrorResponse } },
  },
  async (req, res) => {
    // `querySchema` documents the parameter; the value is read raw, same as
    // the strip list, so the 400 text stays with the other query parsers.
    const pdfDocumentId = parseOptionalQueryInt(req.query.pdf_document_id, "pdf_document_id");
    if (pdfDocumentId === undefined) throw ErrorFactory.badRequest('"pdf_document_id" is required');

    res.json(await req.queryBus.send(new ListFoldersWithStripsQuery(pdfDocumentId)));
  },
);

/** Append a folder to a document. */
foldersRouter.post(
  "/",
  {
    bodySchema: CreateFolderBodySchema,
    responseSchema: FolderSchema,
    successStatus: 201,
    summary: "Create a folder at the end of a document",
    tags: ["folders"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      404: { description: "The parent document does not exist", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    res.status(201).json(await req.commandBus.send(new CreateFolderCommand(req.body)));
  },
);

/** Apply a drag of the folder list. */
foldersRouter.post(
  "/reorder",
  {
    bodySchema: ReorderFoldersBodySchema,
    responseSchema: z.array(FolderWithStripsSchema),
    summary: "Reorder a document's folders",
    tags: ["folders"],
    responses: {
      400: { description: "folder_ids is not a permutation of the document's folders", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    res.json(await req.commandBus.send(new ReorderFoldersCommand(req.body)));
  },
);

/** Rename a folder. */
foldersRouter.patch(
  "/:id",
  {
    bodySchema: RenameFolderBodySchema,
    responseSchema: FolderSchema,
    summary: "Rename a folder",
    tags: ["folders"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      404: { description: "No such folder", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    res.json(await req.commandBus.send(new RenameFolderCommand(id, req.body.name)));
  },
);

/**
 * Delete a folder.
 *
 * `?with_strips=true` deletes the strips it holds too; without it a folder that
 * still has strips answers 409, which is the safe default for a bare DELETE.
 */
foldersRouter.delete(
  "/:id",
  {
    querySchema: DeleteFolderQuerySchema,
    summary: "Delete a folder, optionally with the strips inside it",
    tags: ["folders"],
    responses: {
      204: { description: "Folder deleted" },
      400: { description: "Invalid id or with_strips value", schema: ErrorResponse },
      404: { description: "No such folder", schema: ErrorResponse },
      409: { description: "The folder still has strips and with_strips was not set", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    const withStrips = parseOptionalQueryBoolean(req.query.with_strips, "with_strips") ?? false;

    await req.commandBus.send(new DeleteFolderCommand(id, withStrips));
    res.status(204).end();
  },
);
