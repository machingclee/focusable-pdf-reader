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
import type { FocusableStrip } from "../types.ts";

/** Name of the folder created when a document gets its first strip. */
const DEFAULT_FOLDER_NAME = "Strips";

/** Save the strip the viewer just placed. */
@CommandHandler(CreateFocusableStripCommand, {
  inject: [PrismaUnitOfWork],
  emits: [FocusableStripCreatedEvent],
})
export class CreateFocusableStripCommandHandler implements ICommandHandler<CreateFocusableStripCommand, FocusableStrip> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

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

    // A saved strip always lands in a folder: the viewer has no way to say "put
    // this one in no folder", so the unfiled group is reached by moving.
    const folder = await this.folderForNewStrip(db, pdf_document_id, folder_id);
    const strip = await db.focusable_strip.create({
      data: {
        pdf_document_id,
        folder_id: folder.id,
        ordering: await this.nextStripOrdering(db, folder.id),
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
      new FocusableStripCreatedEvent(strip.id, strip.pdf_document_id, folder.id, strip.page_number),
    );
    return strip;
  }

  /**
   * The folder a newly saved strip belongs to.
   *
   * The viewer knows the document, not which folder the reader had open, so a
   * missing `folderId` means "the first folder". A document that has none yet
   * gets the default folder rather than refusing the save.
   */
  private async folderForNewStrip(
    db: Prisma.TransactionClient,
    pdfDocumentId: number,
    folderId: number | undefined,
  ): Promise<folder> {
    if (folderId !== undefined) {
      const folder = await db.folder.findUnique({ where: { id: folderId } });
      if (!folder || folder.pdf_document_id !== pdfDocumentId) {
        throw ErrorFactory.ofNotFound(`Folder ${folderId} does not exist on document ${pdfDocumentId}`);
      }
      return folder;
    }

    const existing = await db.folder.findFirst({
      where: { pdf_document_id: pdfDocumentId },
      orderBy: { ordering: "asc" },
    });
    if (existing) return existing;

    return db.folder.create({
      data: {
        pdf_document_id: pdfDocumentId,
        name: DEFAULT_FOLDER_NAME,
        ordering: 0,
        created_at: Date.now(),
      },
    });
  }

  /** Next `ordering` at the end of a folder, so a new strip does not jump the queue. */
  private async nextStripOrdering(db: Prisma.TransactionClient, folderId: number): Promise<number> {
    const last = await db.focusable_strip.aggregate({
      where: { folder_id: folderId },
      _max: { ordering: true },
    });
    return (last._max.ordering ?? -1) + 1;
  }
}
