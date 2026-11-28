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
import {
  checkedAnnotationFontSize,
  checkedAnnotationText,
  checkedAnnotationWidth,
  checkedPlacement,
} from "../annotation/rules.ts";
import { UpdatePdfAnnotationCommand } from "../command/UpdatePdfAnnotationCommand.ts";
import { SetAnnotationFieldsCommand } from "../command/annotationReplayCommands.ts";
import type { Annotation } from "../types.ts";

/**
 * Rewrite one annotation: its text, where it stands, its width, or its type size.
 *
 * A text edit names only the text; a move names the page and both coordinates,
 * because a pin is a point and half a placement would leave it at a stale corner.
 * The width is the content's edge, and the type size is how the writing reads beside
 * the passage: both are the reader's choices, kept per row. Saving the values a pin
 * already has writes nothing and records no step, so opening the editor (or starting
 * a move and putting the pointer back where it began) leaves the stack alone.
 *
 * The step's undo is the row as it was, whole: a retype that also moved the pin
 * would otherwise need two steps, and `⌘Z` would put back half an edit.
 */
@CommandHandler(UpdatePdfAnnotationCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class UpdatePdfAnnotationCommandHandler
  implements ICommandHandler<UpdatePdfAnnotationCommand, Annotation> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(command: UpdatePdfAnnotationCommand, context: CommandContext): Promise<Annotation> {
    const db = this.uow.db();
    const existing = await db.annotation.findUnique({ where: { id: command.id } });
    if (!existing) throw ErrorFactory.ofNotFound(`Annotation ${command.id} does not exist`);

    const { text, page_number, x, y, width, font_size } = command.changes;
    const moving = page_number !== undefined || x !== undefined || y !== undefined;
    if (text === undefined && !moving && width === undefined && font_size === undefined) {
      throw ErrorFactory.ofBadRequest(
        "an edit names the text, the width, the font size, or the page and point it moves to",
      );
    }

    const nextText = text === undefined ? existing.text : checkedAnnotationText(text);
    const nextWidth = width === undefined ? existing.width : checkedAnnotationWidth(width);
    const nextFont = font_size === undefined ? existing.font_size : checkedAnnotationFontSize(font_size);
    let nextPage = existing.page_number;
    let nextX = existing.x;
    let nextY = existing.y;
    if (moving) {
      if (page_number === undefined || x === undefined || y === undefined) {
        throw ErrorFactory.ofBadRequest("a move names the page, x and y together");
      }
      const document = await db.pdf_document.findUnique({
        where: { id: existing.pdf_document_id },
        select: { page_count: true },
      });
      const placement = checkedPlacement(page_number, x, y, document?.page_count ?? null);
      nextPage = placement.page_number;
      nextX = placement.x;
      nextY = placement.y;
    }

    const unchanged =
      nextText === existing.text &&
      nextWidth === existing.width &&
      nextFont === existing.font_size &&
      nextPage === existing.page_number &&
      nextX === existing.x &&
      nextY === existing.y;
    if (unchanged) return existing;

    const stored = await db.annotation.update({
      where: { id: command.id },
      data: {
        text: nextText,
        width: nextWidth,
        font_size: nextFont,
        page_number: nextPage,
        x: nextX,
        y: nextY,
      },
    });
    /** One name per kind of edit: a drag, a resize, a type size and a retype read differently in the log. */
    const label =
      text !== undefined
        ? "Annotation"
        : moving
          ? "Move annotation"
          : font_size !== undefined
            ? "Annotation text size"
            : "Resize annotation";
    recordHistory(context, this.history, {
      label,
      undo: new SetAnnotationFieldsCommand(stored.id, {
        page_number: existing.page_number,
        x: existing.x,
        y: existing.y,
        width: existing.width,
        font_size: existing.font_size,
        text: existing.text,
      }),
      redo: new SetAnnotationFieldsCommand(stored.id, {
        page_number: stored.page_number,
        x: stored.x,
        y: stored.y,
        width: stored.width,
        font_size: stored.font_size,
        text: stored.text,
      }),
      trashFiles: [],
    });
    return stored;
  }
}
