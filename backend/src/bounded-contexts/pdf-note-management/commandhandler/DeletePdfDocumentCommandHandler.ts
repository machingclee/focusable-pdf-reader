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
import { PdfLibraryCopyReleasedEvent } from "../event/PdfLibraryCopyReleasedEvent.ts";

/**
 * Remove a document, and the folders and strips the database cascades with it.
 *
 * The library copy goes too, and only that copy: a path outside the library is
 * a file the reader still owns, and deleting the document must not touch it.
 */
@CommandHandler(DeletePdfDocumentCommand, {
  inject: [PrismaUnitOfWork],
  emits: [PdfDocumentDeletedEvent, PdfLibraryCopyReleasedEvent],
  afterCommit: [PdfLibraryCopyReleasedEvent]
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
    context.events.add(new PdfDocumentDeletedEvent(existing.id, stripCount, remainingNotes));
    // After the transaction commits, and only then. A policy that refuses the
    // delete rolls the row back; removing the file first would leave that row
    // pointing at a path that is no longer a file.
    if (libraryCopy) context.events.addTransactional(new PdfLibraryCopyReleasedEvent(libraryCopy));
  }
}
