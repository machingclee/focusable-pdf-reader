import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { UpdatePdfTagCommand } from "../command/UpdatePdfTagCommand.ts";
import { PdfTagUpdatedEvent } from "../event/PdfTagUpdatedEvent.ts";
import { PdfTagCatalogService } from "../service/PdfTagCatalogService.ts";
import type { PdfTagWithCount } from "../types.ts";

/**
 * Rename a tag and/or move it between folders.
 *
 * `pdf_tag_folder_id: null` moves it to Ungrouped; omitting the key leaves the
 * folder alone. That distinction is why the handler checks presence, not value.
 */
@CommandHandler(UpdatePdfTagCommand, {
  inject: [PrismaUnitOfWork, PdfTagCatalogService],
  emits: [PdfTagUpdatedEvent],
})
export class UpdatePdfTagCommandHandler
  implements ICommandHandler<UpdatePdfTagCommand, PdfTagWithCount> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly catalog: PdfTagCatalogService,
  ) { }

  async handle(
    command: UpdatePdfTagCommand,
    context: CommandContext,
  ): Promise<PdfTagWithCount> {
    const db = this.uow.db();
    const existing = await db.pdf_tag.findUnique({ where: { id: command.id } });
    if (!existing) throw ErrorFactory.ofNotFound(`PDF tag ${command.id} does not exist`);

    const data: { name?: string; name_lower?: string; pdf_tag_folder_id?: number | null } = {};
    if (command.input.name !== undefined) {
      const name = this.catalog.normalize(command.input.name);
      const key = this.catalog.key(name);
      if (key !== existing.name_lower) await this.catalog.assertUniqueTag(db, key, existing.id);
      data.name = name;
      data.name_lower = key;
    }
    if ("pdf_tag_folder_id" in command.input) {
      const folderId = command.input.pdf_tag_folder_id ?? null;
      if (folderId !== null) {
        const folder = await db.pdf_tag_folder.findUnique({ where: { id: folderId } });
        if (!folder) throw ErrorFactory.ofNotFound(`Tag folder ${folderId} does not exist`);
      }
      data.pdf_tag_folder_id = folderId;
    }

    if (Object.keys(data).length === 0) return this.catalog.tagWithCount(db, existing.id);

    const tag = await db.pdf_tag.update({ where: { id: command.id }, data });
    context.events.add(new PdfTagUpdatedEvent(tag.id, tag.name));
    return this.catalog.tagWithCount(db, tag.id);
  }
}
