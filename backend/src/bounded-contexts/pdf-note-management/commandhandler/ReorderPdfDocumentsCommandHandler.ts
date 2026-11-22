import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import type { Prisma } from "../../../generated/prisma/client.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ReorderPdfDocumentsCommand } from "../command/ReorderPdfDocumentsCommand.ts";
import { PdfDocumentsReorderedEvent } from "../event/PdfDocumentsReorderedEvent.ts";
import { PdfNotesService } from "../service/PdfNotesService.ts";
import type { PdfDocumentWithCount } from "../types.ts";

/** Apply a drag of the notes document list. */
@CommandHandler(ReorderPdfDocumentsCommand, {
  inject: [PrismaUnitOfWork],
  emits: [PdfDocumentsReorderedEvent],
})
export class ReorderPdfDocumentsCommandHandler
  implements ICommandHandler<ReorderPdfDocumentsCommand, PdfDocumentWithCount[]> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(
    command: ReorderPdfDocumentsCommand,
    context: CommandContext,
  ): Promise<PdfDocumentWithCount[]> {
    const documents = await this.reorderDocuments(this.uow.db(), command.input.document_ids);
    context.events.add(new PdfDocumentsReorderedEvent(command.input.document_ids.length));
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
    PdfNotesService.assertSameIds(
      existing.map((document) => document.id),
      documentIds,
      "document_ids must list every document once",
    );

    for (const [ordering, id] of documentIds.entries()) {
      await db.pdf_document.update({ where: { id }, data: { ordering } });
    }
    return PdfNotesService.listDocuments(db);
  }
}
