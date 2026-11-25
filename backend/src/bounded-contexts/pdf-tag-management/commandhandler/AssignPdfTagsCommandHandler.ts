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
import { PdfTagsAssignedEvent } from "../event/PdfTagsAssignedEvent.ts";
import { PdfTagCatalogService } from "../service/PdfTagCatalogService.ts";
import type { DocumentTag } from "../types.ts";

/**
 * Put tags on one document.
 *
 * One `assigned_pdf_tag` row and one junction row per tag that is not already
 * there: the junction carries the document id, the assignment carries the tag,
 * exactly as the reference project's `assigned_tag` + `rel_shellscript_tag`
 * pair. Tags already on the document are skipped, so repeating a Save is safe.
 */
@CommandHandler(AssignPdfTagsCommand, {
  inject: [PrismaUnitOfWork, PdfTagCatalogService, SessionHistory],
  emits: [PdfTagsAssignedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class AssignPdfTagsCommandHandler
  implements ICommandHandler<AssignPdfTagsCommand, DocumentTag[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly catalog: PdfTagCatalogService,
    private readonly history: SessionHistory,
  ) { }

  async handle(
    command: AssignPdfTagsCommand,
    context: CommandContext,
  ): Promise<DocumentTag[]> {
    const db = this.uow.db();
    const document = await db.pdf_document.findUnique({
      where: { id: command.documentId },
      include: {
        assigned_tags: { include: { assigned_pdf_tag: { select: { pdf_tag_id: true } } } },
      },
    });
    if (!document) throw ErrorFactory.ofNotFound(`PDF document ${command.documentId} does not exist`);

    const wanted = [...new Set(command.pdfTagIds)];
    const existing = new Set(
      document.assigned_tags.map((link) => link.assigned_pdf_tag.pdf_tag_id),
    );
    const missing = wanted.filter((tagId) => !existing.has(tagId));
    if (missing.length === 0) return this.catalog.tagsForDocument(db, document.id);

    const tags = await db.pdf_tag.findMany({
      where: { id: { in: missing } },
      select: { id: true },
    });
    if (tags.length !== missing.length) {
      const found = new Set(tags.map((tag) => tag.id));
      const unknown = missing.find((tagId) => !found.has(tagId));
      throw ErrorFactory.ofBadRequest(`PDF tag ${unknown} does not exist`);
    }

    const now = Date.now();
    for (const pdfTagId of missing) {
      // The assignment row owns the tag; the junction owns the document. Both
      // are written together because neither has meaning without the other.
      await db.rel_pdf_document_assigned_pdf_tag.create({
        data: {
          created_at: now,
          pdf_document: { connect: { id: document.id } },
          assigned_pdf_tag: { create: { pdf_tag_id: pdfTagId, created_at: now } },
        },
      });
    }
    context.events.add(new PdfTagsAssignedEvent(document.id, missing.length));
    recordHistory(context, this.history, {
      label: "Assign tags",
      undo: new UnassignPdfTagsCommand(document.id, missing),
      redo: command,
      trashFiles: [],
    });
    return this.catalog.tagsForDocument(db, document.id);
  }
}
