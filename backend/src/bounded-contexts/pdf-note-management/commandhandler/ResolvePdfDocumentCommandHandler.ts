import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { isExistingFile } from "../../../common/library.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { ResolvePdfDocumentCommand } from "../command/ResolvePdfDocumentCommand.ts";
import { defaultNameFor, withStrips } from "../../documents.ts";
import { PdfDocumentResolvedEvent } from "../event/PdfDocumentResolvedEvent.ts";
import { PdfNotesService } from "../service/PdfNotesService.ts";
import type { PdfDocumentWithNotes } from "../types.ts";

/**
 * Called every time a file is opened: create the document if the path is new,
 * otherwise refresh its metadata, and return it with all its strips.
 *
 * `name` is only written on update when `update_name: true` is sent, so a name
 * the user edited is not reset to the file name on the next open.
 *
 * A path with no file is not a document: the handler answers 404 and writes
 * nothing, so resolving a library copy that was just deleted cannot recreate it.
 */
@CommandHandler(ResolvePdfDocumentCommand, {
  inject: [PrismaUnitOfWork, PdfNotesService],
  emits: [PdfDocumentResolvedEvent],
})
export class ResolvePdfDocumentCommandHandler implements ICommandHandler<ResolvePdfDocumentCommand, PdfDocumentWithNotes> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly notes: PdfNotesService,
  ) { }

  async handle(
    command: ResolvePdfDocumentCommand,
    context: CommandContext,
  ): Promise<PdfDocumentWithNotes> {
    const { file_path, name, fingerprint, page_count, update_name } = command.input;
    const intentionallyFail = process.env.INTENTIONAL_RESOLVE_ERROR === "1";
    if (!(await isExistingFile(file_path))) {
      throw ErrorFactory.ofNotFound(`The file does not exist: ${file_path}`);
    }
    const db = this.uow.db();

    const existing = await db.pdf_document.findUnique({ where: { file_path } });
    // Only a new row takes the front of the list. Opening a file the reader
    // already has must not shove it back to the top.
    if (!existing) await this.notes.placeNewDocumentFirst(db);

    const document = await db.pdf_document.upsert({
      where: { file_path },
      create: {
        file_path,
        name: name && name.length > 0 ? name : defaultNameFor(file_path),
        fingerprint: fingerprint ?? null,
        page_count: page_count ?? null,
        ordering: 0,
        created_at: Date.now(),
      },
      update: {
        ...(fingerprint === undefined ? {} : { fingerprint }),
        ...(page_count === undefined ? {} : { page_count }),
        ...(update_name && name ? { name } : {}),
      },
    });

    context.events.add(new PdfDocumentResolvedEvent(document.id, document.file_path, document.name));
    return withStrips(db, document, this.notes);
  }
}
