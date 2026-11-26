import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
/**
 * Reactions that follow a document or a folder leaving, and the one that
 * remembers which document was just resolved.
 *
 * The delete rules refuse a row that still holds notes. Remembering the last
 * resolved document is the other direction: this writes its id onto the
 * singleton settings row in the same transaction as the resolve.
 */

import {
  BoundedContext,
  CommandBus,
  EventListener,
  Invariant,
  Policy,
} from "@machingclee/express-cqrs";
import { UpdateAppStateCommand } from "../command/UpdateAppStateCommand.ts";
import { NoteFolderDeletedEvent } from "../event/NoteFolderDeletedEvent.ts";
import { PdfDocumentDeletedEvent } from "../event/PdfDocumentDeletedEvent.ts";
import { PdfDocumentResolvedEvent } from "../event/PdfDocumentResolvedEvent.ts";
import { PdfLibraryCopyReleasedEvent } from "../event/PdfLibraryCopyReleasedEvent.ts";
import { ErrorFactory } from "../../../common/http.ts";
import { ResolvePdfDocumentCommand } from "../command/ResolvePdfDocumentCommand.ts";
import { isExistingFile, isInsideDir, libraryDir, moveLibraryCopyToTrash } from "../../../common/library.ts";
import { PrismaUnitOfWork } from "../../../infrastructure/prisma/unitOfWork.ts";
import { NoteCreatedEvent } from "../event/NoteCreatedEvent.ts";
import { CreateNoteFolderCommand } from "../command/CreateNoteFolderCommand.ts";
import { AssignNoteFolderCommand } from "../command/AssignNoteFolderCommand.ts";


const DEFAULT_FOLDER_NAME = "Notes";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Policy({ inject: [CommandBus, PrismaUnitOfWork] })
export class PdfPolicy {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly uow: PrismaUnitOfWork,
  ) { }

  @EventListener(PdfDocumentResolvedEvent, { sends: [UpdateAppStateCommand] })
  @Invariant("AppState should be adjusted after we resolved the filepath and opened it")
  async onPdfDocumentResolved(event: PdfDocumentResolvedEvent): Promise<void> {
    await this.commandBus.send(
      new UpdateAppStateCommand({ last_opened_pdf_document_id: event.documentId }),
    );
  }

  @EventListener(PdfDocumentDeletedEvent, { sends: [ResolvePdfDocumentCommand] })
  @Invariant("When a deletion leaves one PDF, that PDF is selected")
  async onPdfDocumentDeleted(event: PdfDocumentDeletedEvent): Promise<void> {
    const remaining = await this.uow.db().pdf_document.findMany({
      select: { file_path: true },
    });
    if (remaining.length !== 1) return;
    const filePath = remaining[0]?.file_path;
    // Resolve refuses a path with no file, and that refusal would roll the
    // delete back. A missing copy is not a document that can be selected.
    if (!filePath || !(await isExistingFile(filePath))) return;
    await this.commandBus.send(new ResolvePdfDocumentCommand({ file_path: filePath }));
  }

  @EventListener(NoteFolderDeletedEvent, { sends: [] })
  @Invariant("Nonempty folder (still with notes) cannot be deleted")
  onNoteFolderDeleted(event: NoteFolderDeletedEvent): void {
    const { notesRemaining } = event;
    if (notesRemaining > 0) {
      throw ErrorFactory.ofBadRequest(`Cannot delete folder with ${notesRemaining} notes remaining.`);
    }
  }

  @EventListener(PdfDocumentDeletedEvent, { sends: [] })
  @Invariant("Nonempty pdf (still with notes) cannot be deleted")
  onPdfDeleted(event: PdfDocumentDeletedEvent): void {
    const { remainingNotes } = event;
    if (remainingNotes > 0) {
      throw ErrorFactory.ofBadRequest(`Cannot delete PDF with ${remainingNotes} notes remaining.`);
    }
  }

  @EventListener(PdfLibraryCopyReleasedEvent, { sends: [] })
  @Invariant("A committed deletion parks the library copy in the trash and leaves the reader's own file")
  async onLibraryCopyReleased(event: PdfLibraryCopyReleasedEvent): Promise<void> {
    // The handler already decided this path is inside the library. Checked
    // again here because this is the call that moves a file. The trash keeps it
    // until undo restores it or the undo step is discarded.
    if (!isInsideDir(libraryDir(), event.filePath)) return;
    await moveLibraryCopyToTrash(event.filePath);
  }

  @EventListener(NoteCreatedEvent, {
    sends: [CreateNoteFolderCommand, AssignNoteFolderCommand],
  })
  @Invariant("A strip saved with no folder opens a Notes folder and sits in it")
  async onNoteCreated(event: NoteCreatedEvent): Promise<void> {
    if (event.folderId !== null) return;

    const folder = await this.commandBus.send(
      new CreateNoteFolderCommand({
        pdf_document_id: event.documentId,
        name: DEFAULT_FOLDER_NAME,
      }),
    );
    await this.commandBus.send(new AssignNoteFolderCommand(event.stripId, folder.id));
  }
}
