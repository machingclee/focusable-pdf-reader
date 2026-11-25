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
import { DeletePdfTagFolderCommand } from "../command/DeletePdfTagFolderCommand.ts";
import { RestorePdfTagFolderCommand } from "../command/historyReplayCommands.ts";
import { PdfTagFolderDeletedEvent } from "../event/PdfTagFolderDeletedEvent.ts";

/**
 * Delete a tag folder.
 *
 * The handler removes the row and renumbers the remaining folders so the drag
 * order stays dense for the next reorder.
 *
 * `PdfTagPolicy` refuses a folder that still holds tags, and this handler is
 * what gives it the evidence: the tags' `pdf_tag_folder_id` is `ON DELETE SET
 * NULL`, so once the row is gone nothing can tell how many tags were inside. The
 * count is read before the delete and travels on the event.
 */
@CommandHandler(DeletePdfTagFolderCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [PdfTagFolderDeletedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class DeletePdfTagFolderCommandHandler
  implements ICommandHandler<DeletePdfTagFolderCommand> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(
    command: DeletePdfTagFolderCommand,
    context: CommandContext,
  ): Promise<void> {
    const db = this.uow.db();
    const folder = await db.pdf_tag_folder.findUnique({
      where: { id: command.id },
      include: { _count: { select: { tags: true } } },
    });
    if (!folder) throw ErrorFactory.ofNotFound(`Tag folder ${command.id} does not exist`);

    // The delete renumbers the survivors, so the order has to be read before it
    // happens; undoing the step has to put those positions back.
    const order = await db.pdf_tag_folder.findMany({
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const { _count, ...snapshot } = folder;

    await db.pdf_tag_folder.delete({ where: { id: command.id } });
    const remaining = await db.pdf_tag_folder.findMany({
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    for (const [ordering, row] of remaining.entries()) {
      await db.pdf_tag_folder.update({ where: { id: row.id }, data: { ordering } });
    }
    context.events.add(new PdfTagFolderDeletedEvent(folder.id, folder._count.tags));
    recordHistory(context, this.history, {
      label: "Delete tag folder",
      undo: new RestorePdfTagFolderCommand(snapshot, order.map((row) => row.id)),
      redo: command,
      trashFiles: [],
    });
  }
}
