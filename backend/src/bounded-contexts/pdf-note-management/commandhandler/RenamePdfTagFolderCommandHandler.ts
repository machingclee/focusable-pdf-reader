import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { RenamePdfTagFolderCommand } from "../command/RenamePdfTagFolderCommand.ts";
import { PdfTagFolderRenamedEvent } from "../event/PdfTagFolderRenamedEvent.ts";
import { PdfTagCatalogService } from "../service/PdfTagCatalogService.ts";
import type { PdfTagFolder } from "../types.ts";

@CommandHandler(RenamePdfTagFolderCommand, {
  inject: [PrismaUnitOfWork, PdfTagCatalogService],
  emits: [PdfTagFolderRenamedEvent],
})
export class RenamePdfTagFolderCommandHandler
  implements ICommandHandler<RenamePdfTagFolderCommand, PdfTagFolder> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly catalog: PdfTagCatalogService,
  ) { }

  async handle(
    command: RenamePdfTagFolderCommand,
    context: CommandContext,
  ): Promise<PdfTagFolder> {
    const db = this.uow.db();
    const existing = await db.pdf_tag_folder.findUnique({ where: { id: command.id } });
    if (!existing) throw ErrorFactory.ofNotFound(`Tag folder ${command.id} does not exist`);

    const name = this.catalog.normalize(command.name);
    const key = this.catalog.key(name);
    // A rename that only changes the case is a real change and must not collide with itself.
    if (key !== existing.name_lower) await this.catalog.assertUniqueFolder(db, key, existing.id);

    const folder = await db.pdf_tag_folder.update({
      where: { id: command.id },
      data: { name, name_lower: key },
    });
    context.events.add(new PdfTagFolderRenamedEvent(folder.id, folder.name));
    return folder;
  }
}
