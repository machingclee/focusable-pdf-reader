import { z } from "zod";
import { createDocRouter } from "../docs/routeRegistry.ts";
import { CreateFocusableStripCommand } from "../bounded-contexts/pdf-note-management/command/CreateFocusableStripCommand.ts";
import { DeleteFocusableStripCommand } from "../bounded-contexts/pdf-note-management/command/DeleteFocusableStripCommand.ts";
import { ReorderFocusableStripsCommand } from "../bounded-contexts/pdf-note-management/command/ReorderFocusableStripsCommand.ts";
import { UpdateFocusableStripCommand } from "../bounded-contexts/pdf-note-management/command/UpdateFocusableStripCommand.ts";
import { GetFocusableStripQuery } from "../bounded-contexts/pdf-note-management/query/GetFocusableStripQuery.ts";
import { ListFocusableStripsQuery } from "../bounded-contexts/pdf-note-management/query/ListFocusableStripsQuery.ts";
import { parseIdParam, parseOptionalQueryBoolean, parseOptionalQueryInt } from "../common/http.ts";
import {
  CreateStripBodySchema,
  ErrorResponse,
  FocusableStripSchema,
  FocusableStripWithDocumentSchema,
  FocusableStripsQuerySchema,
  FolderWithStripsSchema,
  ReorderStripsBodySchema,
  UpdateStripBodySchema,
} from "../common/schemas.ts";

/**
 * `/focusable-strips` - a saved focus strip plus the note attached to it.
 *
 * Geometry is in PDF points (1pt = 1 CSS px at 100% zoom), so a strip keeps its
 * place at any zoom level. Reopening one is:
 * `contentLock = { page: page_number, fracY: (top + height / 2) / page_height }`
 * with `stripHeight = height`.
 *
 * The routes parse/validate; the handlers in `src/contexts/pdfNoteManagement/commandhandler` do the work.
 */
export const focusableStripsRouter = createDocRouter("/focusable-strips");

/** All strips, or the strips of one document / one page / no folder. */
focusableStripsRouter.get(
  "/",
  {
    querySchema: FocusableStripsQuerySchema,
    responseSchema: z.array(FocusableStripWithDocumentSchema),
    summary: "List strips, optionally filtered by document, page, or no folder",
    tags: ["focusable-strips"],
    responses: { 400: { description: "Invalid query parameter", schema: ErrorResponse } },
  },
  async (req, res) => {
    // `querySchema` documents the parameters; the values are read raw, so they
    // are parsed here to keep the 400 behaviour.
    const pdfDocumentId = parseOptionalQueryInt(req.query.pdf_document_id, "pdf_document_id");
    const pageNumber = parseOptionalQueryInt(req.query.page_number, "page_number");
    const unfiled = parseOptionalQueryBoolean(req.query.unfiled, "unfiled");

    res.json(
      await req.queryBus.send(
        new ListFocusableStripsQuery({ pdfDocumentId, pageNumber, unfiled }),
      ),
    );
  },
);

/**
 * One strip, with the document it belongs to.
 *
 * A note may reference another note (`[note:12]`), and the nested card has to be
 * able to draw it from the id alone — it may be in a different document than the
 * one on screen, or in a note whose list is not loaded at all.
 */
focusableStripsRouter.get(
  "/:id",
  {
    responseSchema: FocusableStripWithDocumentSchema,
    summary: "Read one strip, with the document it belongs to",
    tags: ["focusable-strips"],
    responses: {
      400: { description: "Invalid id", schema: ErrorResponse },
      404: { description: "No such strip", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    res.json(await req.queryBus.send(new GetFocusableStripQuery(id)));
  },
);

/** Save the strip the viewer just placed. */
focusableStripsRouter.post(
  "/",
  {
    bodySchema: CreateStripBodySchema,
    responseSchema: FocusableStripSchema,
    successStatus: 201,
    summary: "Save the strip the viewer just placed",
    tags: ["focusable-strips"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      404: { description: "The parent document does not exist", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    res.status(201).json(await req.commandBus.send(new CreateFocusableStripCommand(req.body)));
  },
);

/** Apply a drag: the new membership and order of one or more folders. */
focusableStripsRouter.post(
  "/reorder",
  {
    bodySchema: ReorderStripsBodySchema,
    responseSchema: z.array(FolderWithStripsSchema),
    summary: "Reorder strips inside a folder, or move them between folders",
    tags: ["focusable-strips"],
    responses: {
      400: { description: "The groups do not match the folders' strips", schema: ErrorResponse },
      404: { description: "A folder does not exist", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    res.json(await req.commandBus.send(new ReorderFocusableStripsCommand(req.body)));
  },
);

/** Update a strip's geometry and/or markdown remark. */
focusableStripsRouter.patch(
  "/:id",
  {
    bodySchema: UpdateStripBodySchema,
    responseSchema: FocusableStripSchema,
    summary: "Update a strip's geometry or its markdown remark",
    tags: ["focusable-strips"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      404: { description: "No such strip", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    res.json(await req.commandBus.send(new UpdateFocusableStripCommand(id, req.body)));
  },
);

/** Remove a strip. */
focusableStripsRouter.delete(
  "/:id",
  {
    summary: "Remove a strip",
    tags: ["focusable-strips"],
    responses: {
      204: { description: "Strip deleted" },
      400: { description: "Invalid id", schema: ErrorResponse },
      404: { description: "No such strip", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    await req.commandBus.send(new DeleteFocusableStripCommand(id));
    res.status(204).end();
  },
);
