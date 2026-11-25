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
import { AssignPdfTagsCommand } from "../command/AssignPdfTagsCommand.ts";
import { UnassignPdfTagsCommand } from "../command/UnassignPdfTagsCommand.ts";
import { PdfTagsUnassignedEvent } from "../event/PdfTagsUnassignedEvent.ts";
import { PdfTagCatalogService } from "../service/PdfTagCatalogService.ts";
import type { DocumentTag } from "../types.ts";

/**
 * Take tags off one document.
 *
 * Deleting the `assigned_pdf_tag` row is the unassign: its junction row cascades.
 * Ids the document does not carry are skipped, so a repeated request is harmless
 * and a diff-based Save can be retried after a partial failure.
 */
@CommandHandler(UnassignPdfTagsCommand, {
  inject: [PrismaUnitOfWork, PdfTagCatalogService, SessionHistory],
  emits: [PdfTagsUnassignedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class UnassignPdfTagsCommandHandler
  implements ICommandHandler<UnassignPdfTagsCommand, DocumentTag[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly catalog: PdfTagCatalogService,
    private readonly history: SessionHistory,
  ) { }

  async handle(
    command: UnassignPdfTagsCommand,
    context: CommandContext,
  ): Promise<DocumentTag[]> {
    const db = this.uow.db();
    const document = await db.pdf_document.findUnique({
      where: { id: command.documentId },
      include: {
        assigned_tags: {
          include: { assigned_pdf_tag: { select: { id: true, pdf_tag_id: true } } },
        },
      },
    });
    if (!document) throw ErrorFactory.ofNotFound(`PDF document ${command.documentId} does not exist`);

    const unwanted = new Set(command.pdfTagIds);
    const removed = document.assigned_tags.filter((link) =>
      unwanted.has(link.assigned_pdf_tag.pdf_tag_id),
    );
    for (const link of removed) {
      await db.assigned_pdf_tag.delete({ where: { id: link.assigned_pdf_tag.id } });
    }
    context.events.add(new PdfTagsUnassignedEvent(document.id, removed.length));
    // Nothing came off means nothing to remember: a repeated Save is a no-op.
    if (removed.length > 0) {
      const removedTagIds = removed.map((link) => link.assigned_pdf_tag.pdf_tag_id);
      recordHistory(context, this.history, {
        label: "Unassign tags",
        undo: new AssignPdfTagsCommand(document.id, removedTagIds),
        redo: command,
        trashFiles: [],
      });
    }
    return this.catalog.tagsForDocument(db, document.id);
  }
}
