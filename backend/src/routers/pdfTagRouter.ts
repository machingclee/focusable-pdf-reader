import { z } from "zod";
import { createDocRouter } from "../docs/routeRegistry.ts";
import { CreatePdfTagFolderCommand } from "../bounded-contexts/pdf-note-management/command/CreatePdfTagFolderCommand.ts";
import { DeletePdfTagFolderCommand } from "../bounded-contexts/pdf-note-management/command/DeletePdfTagFolderCommand.ts";
import { RenamePdfTagFolderCommand } from "../bounded-contexts/pdf-note-management/command/RenamePdfTagFolderCommand.ts";
import { ReorderPdfTagFoldersCommand } from "../bounded-contexts/pdf-note-management/command/ReorderPdfTagFoldersCommand.ts";
import { CreatePdfTagCommand } from "../bounded-contexts/pdf-note-management/command/CreatePdfTagCommand.ts";
import { DeletePdfTagCommand } from "../bounded-contexts/pdf-note-management/command/DeletePdfTagCommand.ts";
import { UpdatePdfTagCommand } from "../bounded-contexts/pdf-note-management/command/UpdatePdfTagCommand.ts";
import { ListPdfTagFoldersQuery } from "../bounded-contexts/pdf-note-management/query/ListPdfTagFoldersQuery.ts";
import { ListPdfTagsQuery } from "../bounded-contexts/pdf-note-management/query/ListPdfTagsQuery.ts";
import { parseIdParam } from "../common/http.ts";
import {
  CreatePdfTagBodySchema,
  CreatePdfTagFolderBodySchema,
  ErrorResponse,
  PdfTagFolderSchema,
  PdfTagSchema,
  RenamePdfTagFolderBodySchema,
  ReorderPdfTagFoldersBodySchema,
  UpdatePdfTagBodySchema,
} from "../common/schemas.ts";

/**
 * `/pdf-tags` - the tag catalogue: the tags themselves, and the folders that
 * group them.
 *
 * The folders are a sub-resource (`/folders`) rather than a second top-level
 * route, because they only exist to organise tags. Their routes are declared
 * before the `/:id` routes so "folders" is never read as a tag id.
 */
export const pdfTagRouter = createDocRouter("/pdf-tags");

/** Every tag, with how many documents carry it, in catalogue order. */
pdfTagRouter.get(
  "/",
  {
    responseSchema: z.array(PdfTagSchema),
    summary: "List every tag with its document count",
    tags: ["pdf-tags"],
  },
  async (req, res) => {
    res.json(await req.queryBus.send(new ListPdfTagsQuery()));
  },
);

/** Create a tag, optionally filed under a folder. */
pdfTagRouter.post(
  "/",
  {
    bodySchema: CreatePdfTagBodySchema,
    responseSchema: PdfTagSchema,
    successStatus: 201,
    summary: "Create a tag",
    tags: ["pdf-tags"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      404: { description: "The tag folder does not exist", schema: ErrorResponse },
      409: { description: "A tag with that name already exists", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    res.status(201).json(await req.commandBus.send(new CreatePdfTagCommand(req.body)));
  },
);

/** Every tag folder, in drag order. */
pdfTagRouter.get(
  "/folders",
  {
    responseSchema: z.array(PdfTagFolderSchema),
    summary: "List the tag folders in drag order",
    tags: ["pdf-tags"],
  },
  async (req, res) => {
    res.json(await req.queryBus.send(new ListPdfTagFoldersQuery()));
  },
);

/** Append a tag folder to the catalogue. */
pdfTagRouter.post(
  "/folders",
  {
    bodySchema: CreatePdfTagFolderBodySchema,
    responseSchema: PdfTagFolderSchema,
    successStatus: 201,
    summary: "Create a tag folder",
    tags: ["pdf-tags"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      409: { description: "A tag folder with that name already exists", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    res.status(201).json(await req.commandBus.send(new CreatePdfTagFolderCommand(req.body)));
  },
);

/** Apply a drag of the tag-folder list. */
pdfTagRouter.post(
  "/folders/reorder",
  {
    bodySchema: ReorderPdfTagFoldersBodySchema,
    responseSchema: z.array(PdfTagFolderSchema),
    summary: "Reorder the tag folders",
    tags: ["pdf-tags"],
    responses: {
      400: {
        description: "pdf_tag_folder_ids is not a permutation of every tag folder",
        schema: ErrorResponse,
      },
    },
  },
  async (req, res) => {
    res.json(await req.commandBus.send(new ReorderPdfTagFoldersCommand(req.body)));
  },
);

/** Rename a tag folder. */
pdfTagRouter.patch(
  "/folders/:id",
  {
    bodySchema: RenamePdfTagFolderBodySchema,
    responseSchema: PdfTagFolderSchema,
    summary: "Rename a tag folder",
    tags: ["pdf-tags"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      404: { description: "No such tag folder", schema: ErrorResponse },
      409: { description: "A tag folder with that name already exists", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    res.json(await req.commandBus.send(new RenamePdfTagFolderCommand(id, req.body.name)));
  },
);

/**
 * Delete a tag folder.
 *
 * The tags it held keep their rows and move to Ungrouped; only the grouping is
 * lost.
 */
pdfTagRouter.delete(
  "/folders/:id",
  {
    summary: "Delete a tag folder, keeping its tags",
    tags: ["pdf-tags"],
    responses: {
      204: { description: "Tag folder deleted; its tags are now ungrouped" },
      400: { description: "Invalid id", schema: ErrorResponse },
      404: { description: "No such tag folder", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    await req.commandBus.send(new DeletePdfTagFolderCommand(id));
    res.status(204).end();
  },
);

/**
 * Rename a tag and/or move it between folders.
 *
 * `pdf_tag_folder_id: null` moves it to Ungrouped; omitting the field leaves the
 * folder untouched. That distinction is why the body schema keeps the two cases
 * apart (absent vs null) instead of defaulting.
 */
pdfTagRouter.patch(
  "/:id",
  {
    bodySchema: UpdatePdfTagBodySchema,
    responseSchema: PdfTagSchema,
    summary: "Rename a tag or move it to another tag folder",
    tags: ["pdf-tags"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      404: { description: "No such tag or tag folder", schema: ErrorResponse },
      409: { description: "A tag with that name already exists", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    res.json(await req.commandBus.send(new UpdatePdfTagCommand(id, req.body)));
  },
);

/** Delete a tag, and the assignments that point at it. */
pdfTagRouter.delete(
  "/:id",
  {
    summary: "Delete a tag and its document assignments",
    tags: ["pdf-tags"],
    responses: {
      204: { description: "Tag deleted" },
      400: { description: "Invalid id", schema: ErrorResponse },
      404: { description: "No such tag", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    await req.commandBus.send(new DeletePdfTagCommand(id));
    res.status(204).end();
  },
);
