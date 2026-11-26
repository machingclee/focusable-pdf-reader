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
import { DeletePdfDocumentFolderCommand } from "../command/DeletePdfDocumentFolderCommand.ts";
import { RestorePdfDocumentFolderCommand } from "../command/historyReplayCommands.ts";
import { PdfDocumentFolderDeletedEvent } from "../event/PdfDocumentFolderDeletedEvent.ts";

/**
 * Delete a document folder and renumber the survivors.
 *
 * The policy refuses a folder that still holds documents. The count is read
 * before the delete, because the membership rows cascade with the folder and
 * nothing would be left to count afterwards.
 */
@CommandHandler(DeletePdfDocumentFolderCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [PdfDocumentFolderDeletedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class DeletePdfDocumentFolderCommandHandler
  implements ICommandHandler<DeletePdfDocumentFolderCommand> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) {}

  async handle(command: DeletePdfDocumentFolderCommand, context: CommandContext): Promise<void> {
    const db = this.uow.db();
    const folder = await db.pdf_document_folder.findUnique({
      where: { id: command.id },
      include: { _count: { select: { memberships: true } } },
    });
    if (!folder) throw ErrorFactory.ofNotFound(`Document folder ${command.id} does not exist`);

    const order = await db.pdf_document_folder.findMany({
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const { _count, ...snapshot } = folder;

    await db.pdf_document_folder.delete({ where: { id: command.id } });
    const remaining = await db.pdf_document_folder.findMany({
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    for (const [ordering, row] of remaining.entries()) {
      await db.pdf_document_folder.update({ where: { id: row.id }, data: { ordering } });
    }
    context.events.add(new PdfDocumentFolderDeletedEvent(folder.id, folder._count.memberships));
    recordHistory(context, this.history, {
      label: "Delete document folder",
      undo: new RestorePdfDocumentFolderCommand(snapshot, order.map((row) => row.id)),
      redo: command,
      trashFiles: [],
    });
  }
}
