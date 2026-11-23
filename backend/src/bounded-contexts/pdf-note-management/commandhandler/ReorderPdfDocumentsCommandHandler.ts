import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import type { Prisma } from "../../../generated/prisma/client.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ReorderPdfDocumentsCommand } from "../command/ReorderPdfDocumentsCommand.ts";
import { PdfDocumentsReorderedEvent } from "../event/PdfDocumentsReorderedEvent.ts";
import { HistoryStepReadyEvent } from "../event/HistoryStepReadyEvent.ts";
import { recordHistory } from "../history/recordHistory.ts";
import { SessionHistory } from "../history/SessionHistory.ts";
import { PdfNotesService } from "../service/PdfNotesService.ts";
import type { PdfDocumentWithCount } from "../types.ts";

/** Apply a drag of the notes document list. */
@CommandHandler(ReorderPdfDocumentsCommand, {
  inject: [PrismaUnitOfWork, SessionHistory, PdfNotesService],
  emits: [PdfDocumentsReorderedEvent, HistoryStepReadyEvent],
  afterCommit: [HistoryStepReadyEvent],
})
export class ReorderPdfDocumentsCommandHandler
  implements ICommandHandler<ReorderPdfDocumentsCommand, PdfDocumentWithCount[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
    private readonly notes: PdfNotesService,
  ) { }

  async handle(
    command: ReorderPdfDocumentsCommand,
    context: CommandContext,
  ): Promise<PdfDocumentWithCount[]> {
    const db = this.uow.db();
    const before = await db.pdf_document.findMany({
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const previousIds = before.map((document) => document.id);
    const documents = await this.reorderDocuments(db, command.input.document_ids);
    context.events.add(new PdfDocumentsReorderedEvent(command.input.document_ids.length));
    if (!sameSequence(previousIds, command.input.document_ids)) {
      recordHistory(context, this.history, {
        label: "Reorder documents",
        undo: new ReorderPdfDocumentsCommand({ document_ids: previousIds }),
        redo: command,
        trashFiles: [],
      });
    }
    return documents;
  }

  /**
   * Rewrite every document's position.
   *
   * `documentIds` must be exactly the documents that exist, in the new order.
   * `ordering` becomes the index, so the column stays dense and the list query
   * does not have to know about gaps.
   */
  private async reorderDocuments(
    db: Prisma.TransactionClient,
    documentIds: number[],
  ): Promise<PdfDocumentWithCount[]> {
    const existing = await db.pdf_document.findMany({ select: { id: true } });
    this.notes.assertSameIds(
      existing.map((document) => document.id),
      documentIds,
      "document_ids must list every document once",
    );

    for (const [ordering, id] of documentIds.entries()) {
      await db.pdf_document.update({ where: { id }, data: { ordering } });
    }
    return this.notes.listDocuments(db);
  }
}

function sameSequence(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
