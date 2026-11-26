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
import { AssignNoteFolderCommand } from "../command/AssignNoteFolderCommand.ts";
import { PlaceNoteCommand } from "../command/historyReplayCommands.ts";
import { NoteFolderAssignedEvent } from "../event/NoteFolderAssignedEvent.ts";
import type { Note } from "../types.ts";

/** Put a strip at the end of a folder on the same document. */
@CommandHandler(AssignNoteFolderCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [NoteFolderAssignedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class AssignNoteFolderCommandHandler
  implements ICommandHandler<AssignNoteFolderCommand, Note> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(
    command: AssignNoteFolderCommand,
    context: CommandContext,
  ): Promise<Note> {
    const db = this.uow.db();
    const strip = await db.note.findUnique({ where: { id: command.stripId } });
    if (!strip) throw ErrorFactory.ofNotFound(`Focusable strip ${command.stripId} does not exist`);

    const folder = await db.note_folder.findUnique({ where: { id: command.folderId } });
    if (!folder || folder.pdf_document_id !== strip.pdf_document_id) {
      throw ErrorFactory.ofNotFound(
        `NoteFolder ${command.folderId} does not exist on document ${strip.pdf_document_id}`,
      );
    }

    const last = await db.note.aggregate({
      where: { note_folder_id: folder.id },
      _max: { ordering: true },
    });
    const filed = await db.note.update({
      where: { id: strip.id },
      data: {
        note_folder_id: folder.id,
        ordering: (last._max.ordering ?? -1) + 1,
      },
    });

    context.events.add(
      new NoteFolderAssignedEvent(filed.id, filed.pdf_document_id, folder.id),
    );
    if (!this.history.noteAssigned(filed, context.requestId)) {
      recordHistory(context, this.history, {
        label: "Move strip",
        undo: new PlaceNoteCommand(strip.id, strip.note_folder_id, strip.ordering),
        redo: command,
        trashFiles: [],
      });
    }
    return filed;
  }
}
