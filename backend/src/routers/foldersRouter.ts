import { z } from "zod";
import { createDocRouter } from "../docs/routeRegistry.ts";
import { deleteFolder, listFoldersWithStrips, reorderFolders } from "../folders.ts";
import {
  badRequest,
  notFound,
  parseIdParam,
  parseOptionalQueryBoolean,
  parseOptionalQueryInt,
} from "../http.ts";
import {
  CreateFolderBodySchema,
  DeleteFolderQuerySchema,
  ErrorResponse,
  FolderSchema,
  FolderWithStripsSchema,
  FoldersQuerySchema,
  RenameFolderBodySchema,
  ReorderFoldersBodySchema,
} from "../schemas.ts";

/**
 * `/folders` - the named containers a document's strips are dragged between.
 *
 * A folder belongs to one document. Its `ordering` is its position in that
 * document; a strip's `ordering` is its position inside the folder.
 */
export const FOLDERS_MOUNT = "/folders";

export const foldersRouter = createDocRouter(FOLDERS_MOUNT);

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
    const pdf_document_id = parseOptionalQueryInt(req.query.pdf_document_id, "pdf_document_id");
    if (pdf_document_id === undefined) throw badRequest('"pdf_document_id" is required');
    res.json(await listFoldersWithStrips(req.db, pdf_document_id));
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
    const { pdf_document_id, name } = req.body;
    const document = await req.db.pdf_document.findUnique({ where: { id: pdf_document_id } });
    if (!document) throw notFound(`PDF document ${pdf_document_id} does not exist`);

    const last = await req.db.folder.aggregate({
      where: { pdf_document_id },
      _max: { ordering: true },
    });
    const folder = await req.db.folder.create({
      data: {
        pdf_document_id,
        name,
        ordering: (last._max.ordering ?? -1) + 1,
        created_at: Date.now(),
      },
    });
    res.status(201).json(folder);
  },
);

/**
 * Apply a drag of the folder list.
 *
 * Registered before `/:id` so "reorder" is not parsed as a folder id.
 */
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
    const { pdf_document_id, folder_ids } = req.body;
    res.json(await reorderFolders(req.db, pdf_document_id, folder_ids));
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
    const existing = await req.db.folder.findUnique({ where: { id } });
    if (!existing) throw notFound(`Folder ${id} does not exist`);

    const folder = await req.db.folder.update({ where: { id }, data: { name: req.body.name } });
    res.json(folder);
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
    await deleteFolder(req.db, id, { withStrips });
    res.status(204).end();
  },
);
