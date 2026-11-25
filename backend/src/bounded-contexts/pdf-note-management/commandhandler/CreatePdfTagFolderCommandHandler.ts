import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { CreatePdfTagFolderCommand } from "../command/CreatePdfTagFolderCommand.ts";
import { PdfTagFolderCreatedEvent } from "../event/PdfTagFolderCreatedEvent.ts";
import { PdfTagCatalogService } from "../service/PdfTagCatalogService.ts";
import type { PdfTagFolder } from "../types.ts";

/** Append a folder to the tag catalogue. */
@CommandHandler(CreatePdfTagFolderCommand, {
  inject: [PrismaUnitOfWork, PdfTagCatalogService],
  emits: [PdfTagFolderCreatedEvent],
})
export class CreatePdfTagFolderCommandHandler
  implements ICommandHandler<CreatePdfTagFolderCommand, PdfTagFolder> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly catalog: PdfTagCatalogService,
  ) { }

  async handle(
    command: CreatePdfTagFolderCommand,
    context: CommandContext,
  ): Promise<PdfTagFolder> {
    const db = this.uow.db();
    const name = this.catalog.normalize(command.input.name);
    const key = this.catalog.key(name);
    await this.catalog.assertUniqueFolder(db, key);

    const last = await db.pdf_tag_folder.aggregate({ _max: { ordering: true } });
    const folder = await db.pdf_tag_folder.create({
      data: {
        name,
        name_lower: key,
        ordering: (last._max.ordering ?? -1) + 1,
        created_at: Date.now(),
      },
    });
    context.events.add(new PdfTagFolderCreatedEvent(folder.id, folder.name));
    return folder;
  }
}
