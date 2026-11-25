import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
/**
 * What the tag catalogue does when rows leave: the rules it refuses, and the
 * cleanup it owes.
 *
 * A tag folder is a grouping, not an owner, so it may only leave once it is
 * empty; otherwise deleting it would silently scatter its tags to Ungrouped.
 * A tag may only leave once no document carries it; otherwise deleting it would
 * cascade the reader's assignments away without asking. Both refusals throw on an
 * event whose row the handler has already removed, which rolls the transaction
 * back and leaves the tag or the folder in place.
 *
 * The one reaction that deletes on purpose is a document leaving: its assignment
 * rows are the catalogue's, not the document's, so the notes context reports
 * their ids on `PdfDocumentDeletedEvent` and this policy — the tag context's only
 * subscription to the other context — sends `DeleteAssignedPdfTagsCommand`.
 */

import {
  BoundedContext,
  CommandBus,
  EventListener,
  Invariant,
  Policy,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { DeleteAssignedPdfTagsCommand } from "../command/DeleteAssignedPdfTagsCommand.ts";
import { PdfDocumentDeletedEvent } from "../../pdf-note-management/event/PdfDocumentDeletedEvent.ts";
import { PdfTagDeletedEvent } from "../event/PdfTagDeletedEvent.ts";
import { PdfTagFolderDeletedEvent } from "../event/PdfTagFolderDeletedEvent.ts";

@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Policy({ inject: [CommandBus] })
export class PdfTagPolicy {
  constructor(private readonly commandBus: CommandBus) { }

  @EventListener(PdfTagFolderDeletedEvent, { sends: [] })
  @Invariant("Only an empty tag folder can be deleted")
  onPdfTagFolderDeleted(event: PdfTagFolderDeletedEvent): void {
    const { tagCount } = event;
    if (tagCount > 0) {
      throw ErrorFactory.ofBadRequest(
        `Cannot delete tag folder with ${tagCount} tag${tagCount === 1 ? "" : "s"} inside. ` +
        `Only an empty tag folder can be deleted.`,
      );
    }
  }

  @EventListener(PdfTagDeletedEvent, { sends: [] })
  @Invariant("Only an unused tag can be deleted")
  onPdfTagDeleted(event: PdfTagDeletedEvent): void {
    const { assignmentCount } = event;
    if (assignmentCount > 0) {
      throw ErrorFactory.ofBadRequest(
        `Cannot delete tag with ${assignmentCount} assignment${assignmentCount === 1 ? "" : "s"}. ` +
        `Only an unused tag can be deleted.`,
      );
    }
  }

  @EventListener(PdfDocumentDeletedEvent, { sends: [DeleteAssignedPdfTagsCommand] })
  @Invariant("A deleted document takes its tag assignments with it")
  async onPdfDocumentDeleted(event: PdfDocumentDeletedEvent): Promise<void> {
    // Nothing to clean up is still the common case: most documents carry no tags.
    if (event.assignedPdfTagIds.length === 0) return;
    // The tags stay in the catalogue; only the assignments that belonged to this
    // document go, and only here, because the row is what says "this document
    // carried that tag".
    await this.commandBus.send(
      new DeleteAssignedPdfTagsCommand(event.documentId, event.assignedPdfTagIds),
    );
  }
}
