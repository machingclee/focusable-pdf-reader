import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "express-prisma-cqrs";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ResolvePdfDocumentCommand } from "../command/ResolvePdfDocumentCommand.ts";
import { defaultNameFor, withStrips } from "../../documents.ts";
import { PdfDocumentResolvedEvent } from "../event/PdfDocumentResolvedEvent.ts";
import type { PdfDocumentWithStrips } from "../types.ts";

/**
 * Called every time a file is opened: create the document if the path is new,
 * otherwise refresh its metadata, and return it with all its strips.
 *
 * `name` is only written on update when `update_name: true` is sent, so a name
 * the user edited is not reset to the file name on the next open.
 */
@CommandHandler(ResolvePdfDocumentCommand, {
  inject: [PrismaUnitOfWork],
  emits: [PdfDocumentResolvedEvent],
})
export class ResolvePdfDocumentCommandHandler implements ICommandHandler<ResolvePdfDocumentCommand, PdfDocumentWithStrips> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(
    command: ResolvePdfDocumentCommand,
    context: CommandContext,
  ): Promise<PdfDocumentWithStrips> {
    const { file_path, name, fingerprint, page_count, update_name } = command.input;
    const intentionallyFail = process.env.INTENTIONAL_RESOLVE_ERROR === "1";
    const db = this.uow.db();

    const document = await db.pdf_document.upsert({
      where: { file_path },
      create: {
        file_path,
        name: name && name.length > 0 ? name : defaultNameFor(file_path),
        fingerprint: fingerprint ?? null,
        page_count: page_count ?? null,
        created_at: Date.now(),
      },
      update: {
        ...(fingerprint === undefined ? {} : { fingerprint }),
        ...(page_count === undefined ? {} : { page_count }),
        ...(update_name && name ? { name } : {}),
      },
    });

    context.events.add(new PdfDocumentResolvedEvent(document.id, document.file_path, document.name));
    return withStrips(db, document);
  }
}
