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
import { AssignPdfDocumentsToFolderCommand } from "../command/AssignPdfDocumentsToFolderCommand.ts";
import { RemovePdfDocumentsFromFolderCommand } from "../command/RemovePdfDocumentsFromFolderCommand.ts";
import { PdfDocumentsRemovedFromFolderEvent } from "../event/PdfDocumentsRemovedFromFolderEvent.ts";
import { PdfDocumentFolderService } from "../service/PdfDocumentFolderService.ts";
import type { PdfDocumentFolderView } from "../types.ts";

/**
 * Take documents out of one folder and renumber the memberships that remain.
 *
 * A document id that does not exist is a bad request. One that exists but is
 * not in this folder is skipped. Other folders that still hold the document
 * are left alone.
 */
@CommandHandler(RemovePdfDocumentsFromFolderCommand, {
  inject: [PrismaUnitOfWork, PdfDocumentFolderService, SessionHistory],
  emits: [PdfDocumentsRemovedFromFolderEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class RemovePdfDocumentsFromFolderCommandHandler
  implements ICommandHandler<RemovePdfDocumentsFromFolderCommand, PdfDocumentFolderView> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly folders: PdfDocumentFolderService,
    private readonly history: SessionHistory,
  ) {}

  async handle(
    command: RemovePdfDocumentsFromFolderCommand,
    context: CommandContext,
  ): Promise<PdfDocumentFolderView> {
    const db = this.uow.db();
    const folder = await db.pdf_document_folder.findUnique({
      where: { id: command.id },
      include: {
        memberships: { orderBy: [{ ordering: "asc" }, { id: "asc" }] },
      },
    });
    if (!folder) throw ErrorFactory.ofNotFound(`Document folder ${command.id} does not exist`);

    const wanted = [...new Set(command.pdf_document_ids)];
    const documents = await db.pdf_document.findMany({
      where: { id: { in: wanted } },
      select: { id: true },
    });
    if (documents.length !== wanted.length) {
      const found = new Set(documents.map((document) => document.id));
      const unknown = wanted.find((id) => !found.has(id));
      throw ErrorFactory.ofBadRequest(`PDF document ${unknown} does not exist`);
    }

    const drop = new Set(wanted);
    const removed = folder.memberships.filter((membership) => drop.has(membership.pdf_document_id));
    for (const membership of removed) {
      await db.rel_pdf_document_folder_pdf_document.delete({ where: { id: membership.id } });
    }
    const remaining = folder.memberships.filter((membership) => !drop.has(membership.pdf_document_id));
    for (const [ordering, membership] of remaining.entries()) {
      if (membership.ordering !== ordering) {
        await db.rel_pdf_document_folder_pdf_document.update({
          where: { id: membership.id },
          data: { ordering },
        });
      }
    }
    context.events.add(new PdfDocumentsRemovedFromFolderEvent(folder.id, removed.length));
    if (removed.length > 0) {
      recordHistory(context, this.history, {
        label: "Remove documents from folder",
        undo: new AssignPdfDocumentsToFolderCommand(
          folder.id,
          removed.map((membership) => membership.pdf_document_id),
        ),
        redo: command,
        trashFiles: [],
      });
    }
    return this.folders.folder(db, folder.id);
  }
}
