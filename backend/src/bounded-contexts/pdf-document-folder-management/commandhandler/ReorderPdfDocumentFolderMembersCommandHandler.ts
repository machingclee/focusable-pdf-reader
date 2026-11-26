import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { assertSameIds } from "../../common/ids.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { HistoryUndoRedoReadyEvent } from "../../history-management/event/HistoryUndoRedoReadyEvent.ts";
import { SessionHistory } from "../../history-management/service/SessionHistory.ts";
import { recordHistory } from "../../history-management/service/recordHistory.ts";
import { ReorderPdfDocumentFolderMembersCommand } from "../command/ReorderPdfDocumentFolderMembersCommand.ts";
import { PdfDocumentFolderMembersReorderedEvent } from "../event/PdfDocumentFolderMembersReorderedEvent.ts";
import { PdfDocumentFolderService } from "../service/PdfDocumentFolderService.ts";
import type { PdfDocumentFolderView } from "../types.ts";

/** Apply a drag of the documents inside one folder. */
@CommandHandler(ReorderPdfDocumentFolderMembersCommand, {
  inject: [PrismaUnitOfWork, PdfDocumentFolderService, SessionHistory],
  emits: [PdfDocumentFolderMembersReorderedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class ReorderPdfDocumentFolderMembersCommandHandler
  implements ICommandHandler<ReorderPdfDocumentFolderMembersCommand, PdfDocumentFolderView> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly folders: PdfDocumentFolderService,
    private readonly history: SessionHistory,
  ) {}

  async handle(
    command: ReorderPdfDocumentFolderMembersCommand,
    context: CommandContext,
  ): Promise<PdfDocumentFolderView> {
    const db = this.uow.db();
    const folder = await db.pdf_document_folder.findUnique({
      where: { id: command.id },
      include: {
        memberships: {
          orderBy: [{ ordering: "asc" }, { id: "asc" }],
          select: { id: true, pdf_document_id: true },
        },
      },
    });
    if (!folder) throw ErrorFactory.ofNotFound(`Document folder ${command.id} does not exist`);

    const previousIds = folder.memberships.map((membership) => membership.pdf_document_id);
    assertSameIds(
      previousIds,
      command.pdf_document_ids,
      "pdf_document_ids must list every document in this folder once",
    );

    const byDocument = new Map(folder.memberships.map((membership) => [membership.pdf_document_id, membership.id]));
    for (const [ordering, documentId] of command.pdf_document_ids.entries()) {
      const membershipId = byDocument.get(documentId);
      if (membershipId === undefined) {
        throw ErrorFactory.ofBadRequest(`PDF document ${documentId} is not in this folder`);
      }
      await db.rel_pdf_document_folder_pdf_document.update({
        where: { id: membershipId },
        data: { ordering },
      });
    }
    context.events.add(new PdfDocumentFolderMembersReorderedEvent(folder.id, command.pdf_document_ids.length));
    if (!sameSequence(previousIds, command.pdf_document_ids)) {
      recordHistory(context, this.history, {
        label: "Reorder documents in folder",
        undo: new ReorderPdfDocumentFolderMembersCommand(folder.id, previousIds),
        redo: command,
        trashFiles: [],
      });
    }
    return this.folders.folder(db, folder.id);
  }
}

function sameSequence(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
