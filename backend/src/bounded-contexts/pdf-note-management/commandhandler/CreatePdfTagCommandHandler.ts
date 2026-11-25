import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { CreatePdfTagCommand } from "../command/CreatePdfTagCommand.ts";
import { PdfTagCreatedEvent } from "../event/PdfTagCreatedEvent.ts";
import { PdfTagCatalogService } from "../service/PdfTagCatalogService.ts";
import type { PdfTagWithCount } from "../types.ts";

@CommandHandler(CreatePdfTagCommand, {
  inject: [PrismaUnitOfWork, PdfTagCatalogService],
  emits: [PdfTagCreatedEvent],
})
export class CreatePdfTagCommandHandler
  implements ICommandHandler<CreatePdfTagCommand, PdfTagWithCount> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly catalog: PdfTagCatalogService,
  ) { }

  async handle(
    command: CreatePdfTagCommand,
    context: CommandContext,
  ): Promise<PdfTagWithCount> {
    const db = this.uow.db();
    const name = this.catalog.normalize(command.input.name);
    const key = this.catalog.key(name);
    await this.catalog.assertUniqueTag(db, key);

    const folderId = command.input.pdf_tag_folder_id ?? null;
    if (folderId !== null) {
      const folder = await db.pdf_tag_folder.findUnique({ where: { id: folderId } });
      if (!folder) throw ErrorFactory.ofNotFound(`Tag folder ${folderId} does not exist`);
    }

    const tag = await db.pdf_tag.create({
      data: { name, name_lower: key, pdf_tag_folder_id: folderId, created_at: Date.now() },
    });
    context.events.add(new PdfTagCreatedEvent(tag.id, tag.name));
    return { ...tag, document_count: 0 };
  }
}
