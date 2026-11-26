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
import { DeleteNoteCommand } from "../command/DeleteNoteCommand.ts";
import { RestoreNoteCommand } from "../command/historyReplayCommands.ts";
import { NoteDeletedEvent } from "../event/NoteDeletedEvent.ts";
import { plainStrip } from "../snapshot/rows.ts";

@CommandHandler(DeleteNoteCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [NoteDeletedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class DeleteNoteCommandHandler implements ICommandHandler<DeleteNoteCommand> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(command: DeleteNoteCommand, context: CommandContext): Promise<void> {
    const db = this.uow.db();
    const existing = await db.note.findUnique({
      where: { id: command.id },
    });
    if (!existing) throw ErrorFactory.ofNotFound(`Focusable strip ${command.id} does not exist`);

    await db.note.delete({ where: { id: command.id } });
    context.events.add(
      new NoteDeletedEvent(existing.id, existing.pdf_document_id, existing.note_folder_id),
    );
    recordHistory(context, this.history, {
      label: "Delete strip",
      undo: new RestoreNoteCommand(plainStrip(existing)),
      redo: command,
      trashFiles: [],
    });
  }
}
