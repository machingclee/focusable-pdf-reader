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
import { DeletePdfAnnotationCommand } from "../command/DeletePdfAnnotationCommand.ts";
import { RestoreAnnotationCommand } from "../command/annotationReplayCommands.ts";

/**
 * Remove one pin, and remember enough to put it back.
 *
 * The undo is the whole row, id included: a note may already point at this
 * annotation, and `⌘Z` has to leave that reference working rather than pointing
 * at an id nothing answers for any more.
 */
@CommandHandler(DeletePdfAnnotationCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class DeletePdfAnnotationCommandHandler
  implements ICommandHandler<DeletePdfAnnotationCommand> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(command: DeletePdfAnnotationCommand, context: CommandContext): Promise<void> {
    const db = this.uow.db();
    const existing = await db.annotation.findUnique({ where: { id: command.id } });
    if (!existing) throw ErrorFactory.ofNotFound(`Annotation ${command.id} does not exist`);

    await db.annotation.delete({ where: { id: command.id } });
    recordHistory(context, this.history, {
      label: "Delete annotation",
      undo: new RestoreAnnotationCommand(existing),
      redo: command,
      trashFiles: [],
    });
  }
}
