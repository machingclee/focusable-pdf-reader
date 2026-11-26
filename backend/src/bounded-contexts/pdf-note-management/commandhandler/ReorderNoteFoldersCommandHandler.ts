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
import { ReorderNoteFoldersCommand } from "../command/ReorderNoteFoldersCommand.ts";
import { NoteFoldersReorderedEvent } from "../event/NoteFoldersReorderedEvent.ts";
import { PdfNotesService } from "../service/PdfNotesService.ts";
import type { NoteFolderWithNotes } from "../types.ts";

/** Apply a drag of the folder list. */
@CommandHandler(ReorderNoteFoldersCommand, {
  inject: [PrismaUnitOfWork, SessionHistory, PdfNotesService],
  emits: [NoteFoldersReorderedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class ReorderNoteFoldersCommandHandler implements ICommandHandler<ReorderNoteFoldersCommand, NoteFolderWithNotes[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
    private readonly notes: PdfNotesService,
  ) { }

  async handle(
    command: ReorderNoteFoldersCommand,
    context: CommandContext,
  ): Promise<NoteFolderWithNotes[]> {
    const db = this.uow.db();
    const before = await db.note_folder.findMany({
      where: { pdf_document_id: command.input.pdf_document_id },
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const previousIds = before.map((folder) => folder.id);
    const folders = await this.reorderFolders(db, command.input.pdf_document_id, command.input.note_folder_ids);
    context.events.add(
      new NoteFoldersReorderedEvent(command.input.pdf_document_id, command.input.note_folder_ids.length),
    );
    if (!sameSequence(previousIds, command.input.note_folder_ids)) {
      recordHistory(context, this.history, {
        label: "Reorder folders",
        undo: new ReorderNoteFoldersCommand({
          pdf_document_id: command.input.pdf_document_id,
          note_folder_ids: previousIds,
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
  ): Promise<NoteFolderWithNotes[]> {
    const existing = await db.note_folder.findMany({
      where: { pdf_document_id: pdfDocumentId },
      select: { id: true },
    });
    this.notes.assertSameIds(
      existing.map((folder) => folder.id),
      folderIds,
      "note_folder_ids must list every folder of the document once",
    );

    for (const [ordering, id] of folderIds.entries()) {
      await db.note_folder.update({ where: { id }, data: { ordering } });
    }
    return this.notes.listFoldersWithStrips(db, pdfDocumentId);
  }
}

function sameSequence(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
