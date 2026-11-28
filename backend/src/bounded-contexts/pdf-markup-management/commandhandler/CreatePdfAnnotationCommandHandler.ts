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
  ANNOTATION_FONT_DEFAULT,
  ANNOTATION_WIDTH_DEFAULT,
  checkedAnnotationFontSize,
  checkedAnnotationText,
  checkedAnnotationWidth,
  checkedPlacement,
} from "../annotation/rules.ts";
import { CreatePdfAnnotationCommand } from "../command/CreatePdfAnnotationCommand.ts";
import {
  RemoveCreatedAnnotationCommand,
  RestoreAnnotationCommand,
} from "../command/annotationReplayCommands.ts";
import type { Annotation } from "../types.ts";

/**
 * Pin a new piece of text to a page of a document.
 *
 * The row is written where the reader clicked, in PDF points, and the history
 * step keeps its **id**: undo removes that row, and redo puts the same row back.
 * A redo that made a fresh row would leave every `[annotation:<id>]` already
 * pasted into a note pointing at a pin that no longer exists.
 */
@CommandHandler(CreatePdfAnnotationCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class CreatePdfAnnotationCommandHandler
  implements ICommandHandler<CreatePdfAnnotationCommand, Annotation> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(command: CreatePdfAnnotationCommand, context: CommandContext): Promise<Annotation> {
    const db = this.uow.db();
    const document = await db.pdf_document.findUnique({
      where: { id: command.id },
      select: { id: true, page_count: true },
    });
    if (!document) throw ErrorFactory.ofNotFound(`PDF document ${command.id} does not exist`);

    const text = checkedAnnotationText(command.annotation.text);
    const placement = checkedPlacement(
      command.annotation.page_number,
      command.annotation.x,
      command.annotation.y,
      document.page_count,
    );
    const width =
      command.annotation.width === undefined
        ? ANNOTATION_WIDTH_DEFAULT
        : checkedAnnotationWidth(command.annotation.width);
    // A new pin is written in the size the viewer draws writing at; the reader can
    // take it up or down afterwards, and the row keeps that answer, not this one.
    const font_size =
      command.annotation.font_size === undefined
        ? ANNOTATION_FONT_DEFAULT
        : checkedAnnotationFontSize(command.annotation.font_size);
    const row = await db.annotation.create({
      data: {
        pdf_document_id: document.id,
        ...placement,
        width,
        font_size,
        text,
        created_at: Date.now(),
      },
    });

    recordHistory(context, this.history, {
      label: "Annotation",
      undo: new RemoveCreatedAnnotationCommand(row.id),
      redo: new RestoreAnnotationCommand(row),
      trashFiles: [],
    });
    return row;
  }
}
