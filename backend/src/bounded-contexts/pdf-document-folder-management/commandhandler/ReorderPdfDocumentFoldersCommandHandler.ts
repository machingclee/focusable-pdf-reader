import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { assertSameIds } from "../../common/ids.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { HistoryUndoRedoReadyEvent } from "../../history-management/event/HistoryUndoRedoReadyEvent.ts";
import { SessionHistory } from "../../history-management/service/SessionHistory.ts";
import { recordHistory } from "../../history-management/service/recordHistory.ts";
import { ReorderPdfDocumentFoldersCommand } from "../command/ReorderPdfDocumentFoldersCommand.ts";
import { PdfDocumentFoldersReorderedEvent } from "../event/PdfDocumentFoldersReorderedEvent.ts";
import { PdfDocumentFolderService } from "../service/PdfDocumentFolderService.ts";
import type { PdfDocumentFolderView } from "../types.ts";

/** Apply a drag of the document-folder list. */
@CommandHandler(ReorderPdfDocumentFoldersCommand, {
  inject: [PrismaUnitOfWork, PdfDocumentFolderService, SessionHistory],
  emits: [PdfDocumentFoldersReorderedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class ReorderPdfDocumentFoldersCommandHandler
  implements ICommandHandler<ReorderPdfDocumentFoldersCommand, PdfDocumentFolderView[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly folders: PdfDocumentFolderService,
    private readonly history: SessionHistory,
  ) {}

  async handle(
    command: ReorderPdfDocumentFoldersCommand,
    context: CommandContext,
  ): Promise<PdfDocumentFolderView[]> {
    const db = this.uow.db();
    const existing = await db.pdf_document_folder.findMany({
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const previousIds = existing.map((folder) => folder.id);
    assertSameIds(
      previousIds,
      command.input.pdf_document_folder_ids,
      "pdf_document_folder_ids must list every document folder once",
    );

    for (const [ordering, id] of command.input.pdf_document_folder_ids.entries()) {
      await db.pdf_document_folder.update({ where: { id }, data: { ordering } });
    }
    context.events.add(new PdfDocumentFoldersReorderedEvent(command.input.pdf_document_folder_ids.length));
    if (!sameSequence(previousIds, command.input.pdf_document_folder_ids)) {
      recordHistory(context, this.history, {
        label: "Reorder document folders",
        undo: new ReorderPdfDocumentFoldersCommand({ pdf_document_folder_ids: previousIds }),
        redo: command,
        trashFiles: [],
      });
    }
    return this.folders.listFolders(db);
  }
}

function sameSequence(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
