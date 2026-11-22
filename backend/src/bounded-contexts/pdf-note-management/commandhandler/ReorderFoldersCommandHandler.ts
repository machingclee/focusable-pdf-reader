import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "express-prisma-cqrs";
import type { Prisma } from "../../../generated/prisma/client.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ReorderFoldersCommand } from "../command/ReorderFoldersCommand.ts";
import { FoldersReorderedEvent } from "../event/FoldersReorderedEvent.ts";
import { PdfNotesService } from "../service/PdfNotesService.ts";
import type { FolderWithStrips } from "../types.ts";

/** Apply a drag of the folder list. */
@CommandHandler(ReorderFoldersCommand, {
  inject: [PrismaUnitOfWork],
  emits: [FoldersReorderedEvent],
})
export class ReorderFoldersCommandHandler implements ICommandHandler<ReorderFoldersCommand, FolderWithStrips[]> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(
    command: ReorderFoldersCommand,
    context: CommandContext,
  ): Promise<FolderWithStrips[]> {
    const folders = await this.reorderFolders(
      this.uow.db(),
      command.input.pdf_document_id,
      command.input.folder_ids,
    );
    context.events.add(
      new FoldersReorderedEvent(command.input.pdf_document_id, command.input.folder_ids.length),
    );
    return folders;
  }

  /**
   * Rewrite folder positions for one document.
   *
   * `folderIds` must be exactly that document's folders, in the new order.
   * `ordering` becomes the index, so the column stays dense and the list query
   * does not have to know about gaps.
   */
  private async reorderFolders(
    db: Prisma.TransactionClient,
    pdfDocumentId: number,
    folderIds: number[],
  ): Promise<FolderWithStrips[]> {
    const existing = await db.folder.findMany({
      where: { pdf_document_id: pdfDocumentId },
      select: { id: true },
    });
    PdfNotesService.assertSameIds(
      existing.map((folder) => folder.id),
      folderIds,
      "folder_ids must list every folder of the document once",
    );

    for (const [ordering, id] of folderIds.entries()) {
      await db.folder.update({ where: { id }, data: { ordering } });
    }
    return PdfNotesService.listFoldersWithStrips(db, pdfDocumentId);
  }
}
