import { z } from "zod";
import { createDocRouter } from "../docs/routeRegistry.ts";
import { folderForNewStrip, nextStripOrdering, reorderStrips } from "../folders.ts";
import { notFound, parseIdParam, parseOptionalQueryBoolean, parseOptionalQueryInt } from "../http.ts";
import {
  CreateStripBodySchema,
  ErrorResponse,
  FocusableStripSchema,
  FocusableStripWithDocumentSchema,
  FocusableStripsQuerySchema,
  FolderWithStripsSchema,
  ReorderStripsBodySchema,
  UpdateStripRemarkBodySchema,
} from "../schemas.ts";

/**
 * `/focusable-strips` - a saved focus strip plus the note attached to it.
 *
 * Geometry is in PDF points (1pt = 1 CSS px at 100% zoom), so a strip keeps its
 * place at any zoom level. Reopening one is:
 * `contentLock = { page: page_number, fracY: (top + height / 2) / page_height }`
 * with `stripHeight = height`.
 */
export const FOCUSABLE_STRIPS_MOUNT = "/focusable-strips";

export const focusableStripsRouter = createDocRouter(FOCUSABLE_STRIPS_MOUNT);

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
    const pdf_document_id = parseOptionalQueryInt(req.query.pdf_document_id, "pdf_document_id");
    const page_number = parseOptionalQueryInt(req.query.page_number, "page_number");
    const unfiled = parseOptionalQueryBoolean(req.query.unfiled, "unfiled");

    const strips = await req.db.focusable_strip.findMany({
      where: {
        ...(pdf_document_id === undefined ? {} : { pdf_document_id }),
        ...(page_number === undefined ? {} : { page_number }),
        ...(unfiled === true ? { folder_id: null } : {}),
      },
      // The strip names its document, so this order holds for folder-less strips
      // too. `ordering` is the drag position inside the strip's own home.
      orderBy: [{ pdf_document_id: "asc" }, { ordering: "asc" }, { id: "asc" }],
      include: { pdf_document: { select: { id: true, name: true, file_path: true } } },
    });

    res.json(strips);
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
    const {
      pdf_document_id,
      folder_id,
      page_number,
      top,
      height,
      left,
      width,
      page_width,
      page_height,
      text_excerpt,
      remark,
    } = req.body;

    const document = await req.db.pdf_document.findUnique({ where: { id: pdf_document_id } });
    if (!document) throw notFound(`PDF document ${pdf_document_id} does not exist`);

    // A saved strip always lands in a folder: the viewer has no way to say "put
    // this one in no folder", so the unfiled group is reached by moving.
    const folder = await folderForNewStrip(req.db, pdf_document_id, folder_id);
    const strip = await req.db.focusable_strip.create({
      data: {
        pdf_document_id,
        folder_id: folder.id,
        ordering: await nextStripOrdering(req.db, folder.id),
        page_number,
        top,
        height,
        left,
        width,
        page_width,
        page_height,
        text_excerpt: text_excerpt ?? null,
        remark: remark ?? "",
        created_at: Date.now(),
      },
    });

    res.status(201).json(strip);
  },
);

/**
 * Apply a drag: the new membership and order of one or more folders.
 *
 * Registered before `/:id` so "reorder" is not parsed as a strip id.
 */
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
    const folders = await reorderStrips(req.db, req.body.groups);
    res.json(folders);
  },
);

/** Update a strip's markdown remark. */
focusableStripsRouter.patch(
  "/:id",
  {
    bodySchema: UpdateStripRemarkBodySchema,
    responseSchema: FocusableStripSchema,
    summary: "Update a strip's markdown remark",
    tags: ["focusable-strips"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      404: { description: "No such strip", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    const { remark } = req.body;

    const existing = await req.db.focusable_strip.findUnique({ where: { id } });
    if (!existing) throw notFound(`Focusable strip ${id} does not exist`);

    const strip = await req.db.focusable_strip.update({ where: { id }, data: { remark } });
    res.json(strip);
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

    const existing = await req.db.focusable_strip.findUnique({ where: { id } });
    if (!existing) throw notFound(`Focusable strip ${id} does not exist`);

    await req.db.focusable_strip.delete({ where: { id } });
    res.status(204).end();
  },
);
