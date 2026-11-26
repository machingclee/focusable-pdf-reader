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
import { DeleteNoteFolderCommand } from "../command/DeleteNoteFolderCommand.ts";
import { RestoreNoteFolderCommand } from "../command/historyReplayCommands.ts";
import { NoteFolderDeletedEvent } from "../event/NoteFolderDeletedEvent.ts";
import { plainNoteFolder, plainStrip } from "../snapshot/rows.ts";

/**
 * Delete a folder.
 *
 * The rule that a folder holding notes needs an explicit `with_strips` belongs
 * here: this is the only place that sees both the note count and the command
 * that asked for the delete. The count is read before the delete, because the
 * cascade removes the notes with the folder.
 */
@CommandHandler(DeleteNoteFolderCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [NoteFolderDeletedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class DeleteNoteFolderCommandHandler implements ICommandHandler<DeleteNoteFolderCommand> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(command: DeleteNoteFolderCommand, context: CommandContext): Promise<void> {
    const db = this.uow.db();
    const folderId = command.id;
    const folder = await db.note_folder.findUnique({
      where: { id: folderId },
      include: { notes: true },
    });
    if (!folder) throw ErrorFactory.ofNotFound(`Note folder ${folderId} does not exist`);
    const notesRemaining = command.withStrips ? 0 : folder.notes.length;
    const { notes: strips, ...folderRow } = folder;
    await db.note_folder.delete({ where: { id: folderId } });
    context.events.add(new NoteFolderDeletedEvent(folderId, notesRemaining));
    recordHistory(context, this.history, {
      label: "Delete folder",
      undo: new RestoreNoteFolderCommand(plainNoteFolder(folderRow), strips.map(plainStrip)),
      redo: command,
      trashFiles: [],
    });
  }
}
