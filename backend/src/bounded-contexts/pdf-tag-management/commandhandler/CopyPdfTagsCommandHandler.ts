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
import { CopyPdfTagsCommand } from "../command/CopyPdfTagsCommand.ts";
import { ReplaceDocumentPdfTagsCommand } from "../command/historyReplayCommands.ts";
import { PdfTagsCopiedEvent } from "../event/PdfTagsCopiedEvent.ts";
import { PdfTagCatalogService } from "../service/PdfTagCatalogService.ts";
import type { DocumentTag } from "../types.ts";

/**
 * Copy one document's tags onto another.
 *
 * The paste is a replace, so it is written as the difference between the two
 * documents: the target's assignment rows the source does not have are deleted
 * (their junction rows cascade), and the source's tags it is missing gain one
 * `assigned_pdf_tag` row plus its junction row — the same pair `AssignPdfTags`
 * writes. A tag on both sides is left alone, so its row survives and a repeated
 * paste changes nothing.
 */
@CommandHandler(CopyPdfTagsCommand, {
  inject: [PrismaUnitOfWork, PdfTagCatalogService, SessionHistory],
  emits: [PdfTagsCopiedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [HistoryUndoRedoReadyEvent],
})
export class CopyPdfTagsCommandHandler
  implements ICommandHandler<CopyPdfTagsCommand, DocumentTag[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly catalog: PdfTagCatalogService,
    private readonly history: SessionHistory,
  ) { }

  async handle(
    command: CopyPdfTagsCommand,
    context: CommandContext,
  ): Promise<DocumentTag[]> {
    const db = this.uow.db();
    const load = (documentId: number) =>
      db.pdf_document.findUnique({
        where: { id: documentId },
        include: {
          assigned_tags: {
            include: { assigned_pdf_tag: { select: { id: true, pdf_tag_id: true } } },
          },
        },
      });

    const source = await load(command.fromDocumentId);
    // A document copied onto itself is its own source: one read, and nothing to
    // compare it with.
    const target =
      command.toDocumentId === command.fromDocumentId ? source : await load(command.toDocumentId);
    if (!source) throw ErrorFactory.ofNotFound(`PDF document ${command.fromDocumentId} does not exist`);
    if (!target) throw ErrorFactory.ofNotFound(`PDF document ${command.toDocumentId} does not exist`);

    const wanted = new Set(source.assigned_tags.map((link) => link.assigned_pdf_tag.pdf_tag_id));
    const carried = new Set(target.assigned_tags.map((link) => link.assigned_pdf_tag.pdf_tag_id));
    const removed = target.assigned_tags.filter(
      (link) => !wanted.has(link.assigned_pdf_tag.pdf_tag_id),
    );
    const added = [...wanted].filter((tagId) => !carried.has(tagId));
    if (removed.length === 0 && added.length === 0) return this.catalog.tagsForDocument(db, target.id);
    // Off first, then on: the rows that stay are the ones both documents carry,
    // and they are never taken away only to be written back.
    for (const link of removed) {
      await db.assigned_pdf_tag.delete({ where: { id: link.assigned_pdf_tag.id } });
    }
    const now = Date.now();
    for (const pdfTagId of added) {
      // The assignment row owns the tag; the junction owns the document. Both
      // are written together because neither has meaning without the other.
      await db.rel_pdf_document_assigned_pdf_tag.create({
        data: {
          created_at: now,
          pdf_document: { connect: { id: target.id } },
          assigned_pdf_tag: { create: { pdf_tag_id: pdfTagId, created_at: now } },
        },
      });
    }
    context.events.add(
      new PdfTagsCopiedEvent(source.id, target.id, removed.length, added.length),
    );
    // A paste is a replace, so its opposite replaces the target with the set it
    // carried before. The redo re-runs the copy: it reads the source as it is
    // then, which is what the reader's paste meant.
    recordHistory(context, this.history, {
      label: "Paste tags",
      undo: new ReplaceDocumentPdfTagsCommand(target.id, [...carried]),
      redo: command,
      trashFiles: [],
    });
    return this.catalog.tagsForDocument(db, target.id);
  }
}
