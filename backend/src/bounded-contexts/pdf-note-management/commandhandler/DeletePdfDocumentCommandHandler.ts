import {
  CommandHandler,
  type CommandContext,
  type ICommandHandler,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { isInsideDir, libraryDir } from "../../../common/library.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { HistoryUndoRedoReadyEvent } from "../../history-management/event/HistoryUndoRedoReadyEvent.ts";
import { SessionHistory } from "../../history-management/service/SessionHistory.ts";
import { recordHistory } from "../../history-management/service/recordHistory.ts";
import { DeletePdfDocumentCommand } from "../command/DeletePdfDocumentCommand.ts";
import { PdfTagCatalogService } from "../../pdf-tag-management/service/PdfTagCatalogService.ts";
import { RestorePdfDocumentCommand } from "../command/historyReplayCommands.ts";
import { PdfDocumentDeletedEvent } from "../event/PdfDocumentDeletedEvent.ts";
import { PdfLibraryCopyReleasedEvent } from "../event/PdfLibraryCopyReleasedEvent.ts";
import { documentHighlightJson, loadDocumentMarks } from "../highlight/marks.ts";
import { plainDocument, plainFolder, plainStrip } from "../snapshot/rows.ts";

/**
 * Remove a document, and the folders and strips the database cascades with it.
 *
 * The library copy goes too, and only that copy: a path outside the library is
 * a file the reader still owns, and deleting the document must not touch it.
 */
@CommandHandler(DeletePdfDocumentCommand, {
  inject: [PrismaUnitOfWork, SessionHistory, PdfTagCatalogService],
  emits: [PdfDocumentDeletedEvent, PdfLibraryCopyReleasedEvent, HistoryUndoRedoReadyEvent],
  afterCommit: [PdfLibraryCopyReleasedEvent, HistoryUndoRedoReadyEvent],
})
export class DeletePdfDocumentCommandHandler implements ICommandHandler<DeletePdfDocumentCommand> {
  constructor(
    private readonly uow: PrismaUnitOfWork,
    private readonly history: SessionHistory,
    private readonly tagCatalog: PdfTagCatalogService,
  ) { }

  async handle(command: DeletePdfDocumentCommand, context: CommandContext): Promise<void> {
    const db = this.uow.db();
    const existing = await db.pdf_document.findUnique({
      where: { id: command.id },
      include: {
        folders: true,
        focusable_strips: true,
        _count: { select: { focusable_strips: true } },
      },
    });
    if (!existing) throw ErrorFactory.ofNotFound(`PDF document ${command.id} does not exist`);

    const marks = await loadDocumentMarks(db, existing.id);
    const stripCount = existing._count.focusable_strips;
    const libraryCopy = isInsideDir(libraryDir(), existing.file_path) ? existing.file_path : null;
    const { folders, focusable_strips: strips, _count: _ignored, ...document } = existing;

    // The assignment rows belong to the PDF tag context, so they are named by its
    // service rather than read from its tables here. Their junction rows cascade
    // with the document, so the ids are captured before the delete and carried on
    // the event; `PdfTagPolicy` deletes the rows when it hears it.
    const assignedPdfTagIds = await this.tagCatalog.assignmentIdsForDocument(db, existing.id);
    await db.pdf_document.delete({ where: { id: command.id } });
    const remainingNotes = stripCount;
    context.events.add(
      new PdfDocumentDeletedEvent(existing.id, stripCount, remainingNotes, assignedPdfTagIds),
    );
    // After the transaction commits, and only then. A policy that refuses the
    // delete rolls the row back; parking the file first would leave that row
    // pointing at a path that is no longer a file.
    if (libraryCopy) context.events.addTransactional(new PdfLibraryCopyReleasedEvent(libraryCopy));
    recordHistory(context, this.history, {
      label: "Delete document",
      undo: new RestorePdfDocumentCommand(
        plainDocument(document),
        folders.map(plainFolder),
        strips.map(plainStrip),
        documentHighlightJson(marks),
      ),
      redo: command,
      trashFiles: libraryCopy ? [libraryCopy] : [],
    });
  }
}
