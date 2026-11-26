import { z } from "zod";
import { createDocRouter } from "../docs/routeRegistry.ts";
import { CreateNoteCommand } from "../bounded-contexts/pdf-note-management/command/CreateNoteCommand.ts";
import { DeleteNoteCommand } from "../bounded-contexts/pdf-note-management/command/DeleteNoteCommand.ts";
import { ReorderNotesCommand } from "../bounded-contexts/pdf-note-management/command/ReorderNotesCommand.ts";
import { UpdateNoteCommand } from "../bounded-contexts/pdf-note-management/command/UpdateNoteCommand.ts";
import { GetNoteQuery } from "../bounded-contexts/pdf-note-management/query/GetNoteQuery.ts";
import { ListNotesQuery } from "../bounded-contexts/pdf-note-management/query/ListNotesQuery.ts";
import { parseIdParam, parseOptionalQueryBoolean, parseOptionalQueryInt } from "../common/http.ts";
import {
  CreateStripBodySchema,
  ErrorResponse,
  NoteSchema,
  NoteWithDocumentSchema,
  NotesQuerySchema,
  NoteFolderWithNotesSchema,
  ReorderStripsBodySchema,
  UpdateStripBodySchema,
} from "../common/schemas.ts";

/**
 * `/notes` - a saved focus strip plus the note attached to it.
 *
 * Geometry is in PDF points (1pt = 1 CSS px at 100% zoom), so a strip keeps its
 * place at any zoom level. Reopening one is:
 * `contentLock = { page: page_number, fracY: (top + height / 2) / page_height }`
 * with `stripHeight = height`.
 *
 * The routes parse/validate; the handlers in `src/bounded-contexts/pdf-note-management/commandhandler` do the work.
 */
export const notesRouter = createDocRouter("/notes");

/** All strips, or the strips of one document / one page / no folder. */
notesRouter.get(
  "/",
  {
    querySchema: NotesQuerySchema,
    responseSchema: z.array(NoteWithDocumentSchema),
    summary: "List strips, optionally filtered by document, page, or no folder",
    tags: ["notes"],
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
        new ListNotesQuery({ pdfDocumentId, pageNumber, unfiled }),
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
notesRouter.get(
  "/:id",
  {
    responseSchema: NoteWithDocumentSchema,
    summary: "Read one strip, with the document it belongs to",
    tags: ["notes"],
    responses: {
      400: { description: "Invalid id", schema: ErrorResponse },
      404: { description: "No such strip", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    res.json(await req.queryBus.send(new GetNoteQuery(id)));
  },
);

/** Save the strip the viewer just placed. */
notesRouter.post(
  "/",
  {
    bodySchema: CreateStripBodySchema,
    responseSchema: NoteSchema,
    successStatus: 201,
    summary: "Save the strip the viewer just placed",
    tags: ["notes"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      404: { description: "The parent document does not exist", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const created = await req.commandBus.send(new CreateNoteCommand(req.body));
    // NotePolicy may open a Notes folder and file this strip into it
    // after the command returns. The response is the row after that reaction.
    const stored = await req.queryBus.send(new GetNoteQuery(created.id));
    res.status(201).json(stored);
  },
);

/** Apply a drag: the new membership and order of one or more folders. */
notesRouter.post(
  "/reorder",
  {
    bodySchema: ReorderStripsBodySchema,
    responseSchema: z.array(NoteFolderWithNotesSchema),
    summary: "Reorder strips inside a folder, or move them between folders",
    tags: ["notes"],
    responses: {
      400: { description: "The groups do not match the folders' strips", schema: ErrorResponse },
      404: { description: "A folder does not exist", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    res.json(await req.commandBus.send(new ReorderNotesCommand(req.body)));
  },
);

/** Update a strip's geometry, its markdown remark, its preview marks, or whether it is folded. */
notesRouter.patch(
  "/:id",
  {
    bodySchema: UpdateStripBodySchema,
    responseSchema: NoteSchema,
    summary: "Update a strip's geometry, its markdown, its preview highlights, or whether it is folded",
    tags: ["notes"],
    responses: {
      400: { description: "The body does not match the schema", schema: ErrorResponse },
      404: { description: "No such strip", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    res.json(await req.commandBus.send(new UpdateNoteCommand(id, req.body)));
  },
);

/** Remove a strip. */
notesRouter.delete(
  "/:id",
  {
    summary: "Remove a strip",
    tags: ["notes"],
    responses: {
      204: { description: "Strip deleted" },
      400: { description: "Invalid id", schema: ErrorResponse },
      404: { description: "No such strip", schema: ErrorResponse },
    },
  },
  async (req, res) => {
    const id = parseIdParam(req.params.id);
    await req.commandBus.send(new DeleteNoteCommand(id));
    res.status(204).end();
  },
);
