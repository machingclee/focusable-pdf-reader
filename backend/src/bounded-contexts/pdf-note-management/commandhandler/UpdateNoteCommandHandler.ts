import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { HistoryUndoRedoReadyEvent } from "../../history-management/event/HistoryUndoRedoReadyEvent.ts";
import { SessionHistory } from "../../history-management/service/SessionHistory.ts";
import { recordHistory } from "../../history-management/service/recordHistory.ts";
import { UpdateNoteCommand } from "../command/UpdateNoteCommand.ts";
import { NoteUpdatedEvent } from "../event/NoteUpdatedEvent.ts";
import { highlightJson, presentStrips, replaceHighlights } from "../highlight/marks.ts";
import type { StripResponse } from "../types.ts";
import type { z } from "zod";
import { isStripHighlightList, type UpdateStripBodySchema } from "../../../common/schemas.ts";

/**
 * Update a strip: the geometry the band was resized to, the markdown remark,
 * the preview's highlights, whether the writing under the preview is shown,
 * or any of them. One command because a strip is the aggregate; neither
 * surface may clear the other's fields, hence the per-field spread instead of
 * a whole-row write. A highlight write replaces the strip's `highlight` rows
 * and leaves the rest of the strip alone. Folding a note leaves the preview.
 */
type StripPatch = z.infer<typeof UpdateStripBodySchema>;

const STRIP_FIELDS = [
  "page_number",
  "top",
  "height",
  "left",
  "width",
  "page_width",
  "page_height",
  "text_excerpt",
  "remark",
  "highlights",
  "expanded",
] as const satisfies readonly (keyof StripPatch)[];

/** "Highlight" when the write is only the preview's marks; otherwise the general name. */
function historyLabel(changes: StripPatch): string {
  const names = STRIP_FIELDS.filter((field) => changes[field] !== undefined);
  if (names.length === 1 && names[0] === "highlights") return "Highlight";
  if (names.length === 1 && names[0] === "expanded") {
    return changes.expanded ? "Expand note" : "Collapse note";
  }
  return "Update strip";
}

/** The previous values of the fields this patch names, or null when none of them change. */
function previousPatch(existing: StripResponse, changes: StripPatch): StripPatch | null {
  const before: StripPatch = {};
  let differs = false;
  for (const field of STRIP_FIELDS) {
    if (changes[field] === undefined) continue;
    before[field] = existing[field] as never;
    if (changes[field] !== existing[field]) differs = true;
  }
  return differs ? before : null;
}

@CommandHandler(UpdateNoteCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [NoteUpdatedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class UpdateNoteCommandHandler implements ICommandHandler<UpdateNoteCommand, StripResponse> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(
    command: UpdateNoteCommand,
    context: CommandContext,
  ): Promise<StripResponse> {
    const {
      page_number,
      top,
      height,
      left,
      width,
      page_width,
      page_height,
      text_excerpt,
      remark,
      highlights,
      expanded,
    } = command.changes;
    if (highlights !== undefined && !isStripHighlightList(highlights)) {
      throw ErrorFactory.ofBadRequest("highlights must be a JSON list of { x0, x1, y, size }");
    }
    const db = this.uow.db();

    const loaded = await db.note.findUnique({ where: { id: command.id } });
    if (!loaded) throw ErrorFactory.ofNotFound(`Focusable strip ${command.id} does not exist`);
    const pageMarks = await db.highlight.findMany({
      where: { pdf_document_id: loaded.pdf_document_id, page_number: loaded.page_number },
      orderBy: { id: "asc" },
    });
    const existing = { ...loaded, highlights: highlightJson(pageMarks) };

    await db.note.update({
      where: { id: command.id },
      data: {
        ...(page_number === undefined ? {} : { page_number }),
        ...(top === undefined ? {} : { top }),
        ...(height === undefined ? {} : { height }),
        ...(left === undefined ? {} : { left }),
        ...(width === undefined ? {} : { width }),
        ...(page_width === undefined ? {} : { page_width }),
        ...(page_height === undefined ? {} : { page_height }),
        ...(text_excerpt === undefined ? {} : { text_excerpt }),
        ...(remark === undefined ? {} : { remark }),
        ...(expanded === undefined ? {} : { expanded }),
      },
    });
    if (highlights !== undefined) await replaceHighlights(db, command.id, highlights);
    const stored = await db.note.findUniqueOrThrow({ where: { id: command.id } });
    const [strip] = await presentStrips(db, [stored]);
    if (!strip) throw ErrorFactory.ofNotFound(`Note ${command.id} does not exist`);

    context.events.add(
      new NoteUpdatedEvent(strip.id, strip.pdf_document_id, strip.page_number),
    );
    const before = previousPatch(existing, command.changes);
    if (before) {
      recordHistory(context, this.history, {
        label: historyLabel(command.changes),
        undo: new UpdateNoteCommand(existing.id, before),
        redo: command,
        trashFiles: [],
      });
    }
    return strip;
  }
}
