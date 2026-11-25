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
import { DeletePdfTagCommand } from "../command/DeletePdfTagCommand.ts";
import { RestorePdfTagCommand } from "../command/historyReplayCommands.ts";
import { PdfTagDeletedEvent } from "../event/PdfTagDeletedEvent.ts";

/**
 * Delete a tag.
 *
 * `PdfTagPolicy` refuses a tag that a document still carries, so this only ever
 * removes an unused tag. The assignment count is captured before the delete and
 * travels on the event: the policy only runs once the row is gone, and its
 * cascade would erase the assignments that answer "was it unused?".
 */
@CommandHandler(DeletePdfTagCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [PdfTagDeletedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class DeletePdfTagCommandHandler implements ICommandHandler<DeletePdfTagCommand> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(command: DeletePdfTagCommand, context: CommandContext): Promise<void> {
    const db = this.uow.db();
    const tag = await db.pdf_tag.findUnique({
      where: { id: command.id },
      include: { _count: { select: { assignments: true } } },
    });
    if (!tag) throw ErrorFactory.ofNotFound(`PDF tag ${command.id} does not exist`);

    const { _count, ...snapshot } = tag;
    await db.pdf_tag.delete({ where: { id: command.id } });
    context.events.add(new PdfTagDeletedEvent(tag.id, tag._count.assignments));
    // Undo puts the row back under the same id; redo deletes it again.
    recordHistory(context, this.history, {
      label: "Delete tag",
      undo: new RestorePdfTagCommand(snapshot),
      redo: command,
      trashFiles: [],
    });
  }
}
