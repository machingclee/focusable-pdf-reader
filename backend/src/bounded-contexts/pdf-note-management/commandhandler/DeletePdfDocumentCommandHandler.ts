import { rm } from "node:fs/promises";
import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { isInsideDir, libraryDir } from "../../../common/library.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { DeletePdfDocumentCommand } from "../command/DeletePdfDocumentCommand.ts";
import { PdfDocumentDeletedEvent } from "../event/PdfDocumentDeletedEvent.ts";

/**
 * Remove a document, and the folders and strips the database cascades with it.
 *
 * The library copy goes too, and only that copy: a path outside the library is
 * a file the reader still owns, and deleting the document must not touch it.
 */
@CommandHandler(DeletePdfDocumentCommand, {
  inject: [PrismaUnitOfWork],
  emits: [PdfDocumentDeletedEvent],
})
export class DeletePdfDocumentCommandHandler implements ICommandHandler<DeletePdfDocumentCommand> {
  constructor(private readonly uow: PrismaUnitOfWork) { }

  async handle(command: DeletePdfDocumentCommand, context: CommandContext): Promise<void> {
    const db = this.uow.db();
    const existing = await db.pdf_document.findUnique({
      where: { id: command.id },
      include: { _count: { select: { focusable_strips: true } } },
    });
    if (!existing) throw ErrorFactory.ofNotFound(`PDF document ${command.id} does not exist`);

    const stripCount = existing._count.focusable_strips;
    const libraryCopy = isInsideDir(libraryDir(), existing.file_path) ? existing.file_path : null;

    await db.pdf_document.delete({ where: { id: command.id } });
    const remainingNotes = existing._count.focusable_strips;
    // After the row is gone, so a failure to delete the row cannot remove a
    // file the document still points at. A missing copy is already the state
    // this is aiming for.
    if (libraryCopy) await rm(libraryCopy, { force: true });

    context.events.add(new PdfDocumentDeletedEvent(existing.id, stripCount, remainingNotes));
  }
}
