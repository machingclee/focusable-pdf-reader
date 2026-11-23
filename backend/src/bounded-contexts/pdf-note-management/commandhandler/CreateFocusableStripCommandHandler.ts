import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import type { folder, Prisma } from "../../../generated/prisma/client.ts";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { CreateFocusableStripCommand } from "../command/CreateFocusableStripCommand.ts";
import { FocusableStripCreatedEvent } from "../event/FocusableStripCreatedEvent.ts";
import { HistoryStepReadyEvent } from "../event/HistoryStepReadyEvent.ts";
import { SessionHistory } from "../history/SessionHistory.ts";
import type { FocusableStrip } from "../types.ts";

/**
 * Save the strip the viewer just placed.
 *
 * A missing folder id uses the document's first folder. A document that has
 * none yet keeps the strip unfiled: `FocusableStripPolicy` opens the Notes
 * folder and files the strip into it, in this same transaction.
 */
@CommandHandler(CreateFocusableStripCommand, {
  inject: [PrismaUnitOfWork, SessionHistory],
  emits: [FocusableStripCreatedEvent, HistoryStepReadyEvent],
  afterCommit: [HistoryStepReadyEvent],
})
export class CreateFocusableStripCommandHandler implements ICommandHandler<CreateFocusableStripCommand, FocusableStrip> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
  ) { }

  async handle(
    command: CreateFocusableStripCommand,
    context: CommandContext,
  ): Promise<FocusableStrip> {
    const {
      pdf_document_id,
      folder_id,
      page_number,
      top,
      height,
      left,
      width,
      page_width,
      page_height,
      text_excerpt,
      remark,
    } = command.input;
    const db = this.uow.db();

    const document = await db.pdf_document.findUnique({ where: { id: pdf_document_id } });
    if (!document) throw ErrorFactory.ofNotFound(`PDF document ${pdf_document_id} does not exist`);

    const folder = await this.folderForNewStrip(db, pdf_document_id, folder_id);
    const strip = await db.focusable_strip.create({
      data: {
        pdf_document_id,
        folder_id: folder?.id ?? null,
        ordering: await this.nextStripOrdering(db, pdf_document_id, folder?.id ?? null),
        page_number,
        top,
        height,
        left,
        width,
        page_width,
        page_height,
        text_excerpt: text_excerpt ?? null,
        remark: remark ?? "",
        created_at: Date.now(),
      },
    });

    context.events.add(
      new FocusableStripCreatedEvent(strip.id, strip.pdf_document_id, strip.folder_id, strip.page_number),
    );
    // The policy may open a folder and file this strip into it before the
    // transaction commits. The draft gathers that, and one step is pushed after
    // commit. Undo of this command must not record that as a second step.
    if (!this.history.isApplying()) {
      this.history.openStripDraft(strip, context.requestId);
      context.events.addTransactional(new HistoryStepReadyEvent("Create strip", null, null, []));
    }
    return strip;
  }

  /**
   * The folder a newly saved strip belongs to, when one already exists.
   *
   * The viewer knows the document, not which folder the reader had open, so a
   * missing folder id means the first folder. Null means the document has no
   * folder yet; the policy opens one after this command emits.
   */
  private async folderForNewStrip(
    db: Prisma.TransactionClient,
    pdfDocumentId: number,
    folderId: number | undefined,
  ): Promise<folder | null> {
    if (folderId !== undefined) {
      const folder = await db.folder.findUnique({ where: { id: folderId } });
      if (!folder || folder.pdf_document_id !== pdfDocumentId) {
        throw ErrorFactory.ofNotFound(`Folder ${folderId} does not exist on document ${pdfDocumentId}`);
      }
      return folder;
    }

    return db.folder.findFirst({
      where: { pdf_document_id: pdfDocumentId },
      orderBy: { ordering: "asc" },
    });
  }

  /** Next `ordering` at the end of a folder, so a new strip does not jump the queue. */
  private async nextStripOrdering(
    db: Prisma.TransactionClient,
    pdfDocumentId: number,
    folderId: number | null,
  ): Promise<number> {
    const last = await db.focusable_strip.aggregate({
      where: { pdf_document_id: pdfDocumentId, folder_id: folderId },
      _max: { ordering: true },
    });
    return (last._max.ordering ?? -1) + 1;
  }
}
