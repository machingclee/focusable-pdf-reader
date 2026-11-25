import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import type { Prisma } from "../../../generated/prisma/client.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { HistoryUndoRedoReadyEvent } from "../../history-management/event/HistoryUndoRedoReadyEvent.ts";
import { SessionHistory } from "../../history-management/service/SessionHistory.ts";
import { recordHistory } from "../../history-management/service/recordHistory.ts";
import { ReorderFoldersCommand } from "../command/ReorderFoldersCommand.ts";
import { FoldersReorderedEvent } from "../event/FoldersReorderedEvent.ts";
import { PdfNotesService } from "../service/PdfNotesService.ts";
import type { FolderWithStrips } from "../types.ts";

/** Apply a drag of the folder list. */
@CommandHandler(ReorderFoldersCommand, {
  inject: [PrismaUnitOfWork, SessionHistory, PdfNotesService],
  emits: [FoldersReorderedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class ReorderFoldersCommandHandler implements ICommandHandler<ReorderFoldersCommand, FolderWithStrips[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
    private readonly notes: PdfNotesService,
  ) { }

  async handle(
    command: ReorderFoldersCommand,
    context: CommandContext,
  ): Promise<FolderWithStrips[]> {
    const db = this.uow.db();
    const before = await db.folder.findMany({
      where: { pdf_document_id: command.input.pdf_document_id },
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const previousIds = before.map((folder) => folder.id);
    const folders = await this.reorderFolders(db, command.input.pdf_document_id, command.input.folder_ids);
    context.events.add(
      new FoldersReorderedEvent(command.input.pdf_document_id, command.input.folder_ids.length),
    );
    if (!sameSequence(previousIds, command.input.folder_ids)) {
      recordHistory(context, this.history, {
        label: "Reorder folders",
        undo: new ReorderFoldersCommand({
          pdf_document_id: command.input.pdf_document_id,
          folder_ids: previousIds,
        }),
        redo: command,
        trashFiles: [],
      });
    }
    return folders;
  }

  /**
   * Rewrite folder positions for one document.
   *
   * `folderIds` must be exactly that document's folders, in the new order.
   * `ordering` becomes the index, so the column stays dense and the list query
   * does not have to know about gaps.
   */
  private async reorderFolders(
    db: Prisma.TransactionClient,
    pdfDocumentId: number,
    folderIds: number[],
  ): Promise<FolderWithStrips[]> {
    const existing = await db.folder.findMany({
      where: { pdf_document_id: pdfDocumentId },
      select: { id: true },
    });
    this.notes.assertSameIds(
      existing.map((folder) => folder.id),
      folderIds,
      "folder_ids must list every folder of the document once",
    );

    for (const [ordering, id] of folderIds.entries()) {
      await db.folder.update({ where: { id }, data: { ordering } });
    }
    return this.notes.listFoldersWithStrips(db, pdfDocumentId);
  }
}

function sameSequence(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
