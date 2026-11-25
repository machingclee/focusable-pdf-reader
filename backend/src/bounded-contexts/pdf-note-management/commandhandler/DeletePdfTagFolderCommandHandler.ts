import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { DeletePdfTagFolderCommand } from "../command/DeletePdfTagFolderCommand.ts";
import { PdfTagFolderDeletedEvent } from "../event/PdfTagFolderDeletedEvent.ts";

/**
 * Delete a tag folder.
 *
 * The tags it held keep their rows: the foreign key is `ON DELETE SET NULL`, so
 * they reappear under Ungrouped. The remaining folders are renumbered so the
 * drag order stays dense for the next reorder.
 */
@CommandHandler(DeletePdfTagFolderCommand, {
  inject: [PrismaUnitOfWork],
  emits: [PdfTagFolderDeletedEvent],
})
export class DeletePdfTagFolderCommandHandler
  implements ICommandHandler<DeletePdfTagFolderCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(
    command: DeletePdfTagFolderCommand,
    context: CommandContext,
  ): Promise<void> {
    const db = this.uow.db();
    const folder = await db.pdf_tag_folder.findUnique({
      where: { id: command.id },
      include: { _count: { select: { tags: true } } },
    });
    if (!folder) throw ErrorFactory.ofNotFound(`Tag folder ${command.id} does not exist`);

    await db.pdf_tag_folder.delete({ where: { id: command.id } });
    const remaining = await db.pdf_tag_folder.findMany({
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    for (const [ordering, row] of remaining.entries()) {
      await db.pdf_tag_folder.update({ where: { id: row.id }, data: { ordering } });
    }
    context.events.add(new PdfTagFolderDeletedEvent(folder.id, folder._count.tags));
  }
}
