import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ReorderPdfTagFoldersCommand } from "../command/ReorderPdfTagFoldersCommand.ts";
import { PdfTagFoldersReorderedEvent } from "../event/PdfTagFoldersReorderedEvent.ts";
import { PdfNotesService } from "../service/PdfNotesService.ts";
import { PdfTagCatalogService } from "../service/PdfTagCatalogService.ts";
import type { PdfTagFolder } from "../types.ts";

/** Apply a drag of the tag-folder list. */
@CommandHandler(ReorderPdfTagFoldersCommand, {
  inject: [PrismaUnitOfWork, PdfNotesService, PdfTagCatalogService],
  emits: [PdfTagFoldersReorderedEvent],
})
export class ReorderPdfTagFoldersCommandHandler
  implements ICommandHandler<ReorderPdfTagFoldersCommand, PdfTagFolder[]> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly notes: PdfNotesService,
    private readonly catalog: PdfTagCatalogService,
  ) { }

  async handle(
    command: ReorderPdfTagFoldersCommand,
    context: CommandContext,
  ): Promise<PdfTagFolder[]> {
    const db = this.uow.db();
    const existing = await db.pdf_tag_folder.findMany({
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    this.notes.assertSameIds(
      existing.map((folder) => folder.id),
      command.input.pdf_tag_folder_ids,
      "pdf_tag_folder_ids must list every tag folder once",
    );

    for (const [ordering, id] of command.input.pdf_tag_folder_ids.entries()) {
      await db.pdf_tag_folder.update({ where: { id }, data: { ordering } });
    }
    context.events.add(new PdfTagFoldersReorderedEvent(command.input.pdf_tag_folder_ids.length));
    return this.catalog.listFolders(db);
  }
}
