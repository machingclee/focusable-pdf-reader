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
import { PdfDocumentsAssignedToFolderEvent } from "../event/PdfDocumentsAssignedToFolderEvent.ts";
import { PdfDocumentFolderService } from "../service/PdfDocumentFolderService.ts";
import type { PdfDocumentFolderView } from "../types.ts";

/**
 * File documents in one folder.
 *
 * A document already in the folder is skipped. A document that also sits in
 * another folder stays there: this adds a membership and removes nothing.
 * New documents are appended, unless `index` says where they should sit among
 * the documents already in the folder.
 */
@CommandHandler(AssignPdfDocumentsToFolderCommand, {
  inject: [PrismaUnitOfWork, PdfDocumentFolderService, SessionHistory],
  emits: [PdfDocumentsAssignedToFolderEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class AssignPdfDocumentsToFolderCommandHandler
  implements ICommandHandler<AssignPdfDocumentsToFolderCommand, PdfDocumentFolderView> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly folders: PdfDocumentFolderService,
    private readonly history: SessionHistory,
  ) {}

  async handle(
    command: AssignPdfDocumentsToFolderCommand,
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

    const wanted = [...new Set(command.pdf_document_ids)];
    await assertDocumentsExist(db, wanted);

    const existing = new Set(folder.memberships.map((membership) => membership.pdf_document_id));
    const added = wanted.filter((documentId) => !existing.has(documentId));
    if (added.length === 0) return this.folders.folder(db, folder.id);

    const ids = folder.memberships.map((membership) => membership.pdf_document_id);
    const at = command.index === undefined
      ? ids.length
      : Math.min(Math.max(command.index, 0), ids.length);
    ids.splice(at, 0, ...added);

    const byDocument = new Map(folder.memberships.map((membership) => [membership.pdf_document_id, membership.id]));
    const now = Date.now();
    for (const [offset, pdfDocumentId] of added.entries()) {
      const created = await db.rel_pdf_document_folder_pdf_document.create({
        data: {
          pdf_document_folder_id: folder.id,
          pdf_document_id: pdfDocumentId,
          ordering: at + offset,
          created_at: now,
        },
      });
      byDocument.set(pdfDocumentId, created.id);
    }
    for (const [ordering, documentId] of ids.entries()) {
      const membershipId = byDocument.get(documentId);
      if (membershipId === undefined) continue;
      await db.rel_pdf_document_folder_pdf_document.update({
        where: { id: membershipId },
        data: { ordering },
      });
    }
    context.events.add(new PdfDocumentsAssignedToFolderEvent(folder.id, added.length));
    recordHistory(context, this.history, {
      label: "Assign documents to folder",
      undo: new RemovePdfDocumentsFromFolderCommand(folder.id, added),
      redo: command,
      trashFiles: [],
    });
    return this.folders.folder(db, folder.id);
  }
}

async function assertDocumentsExist(
  db: ReturnType<PrismaUnitOfWork["db"]>,
  ids: number[],
): Promise<void> {
  const documents = await db.pdf_document.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (documents.length !== ids.length) {
    const found = new Set(documents.map((document) => document.id));
    const unknown = ids.find((id) => !found.has(id));
    throw ErrorFactory.ofBadRequest(`PDF document ${unknown} does not exist`);
  }
}
