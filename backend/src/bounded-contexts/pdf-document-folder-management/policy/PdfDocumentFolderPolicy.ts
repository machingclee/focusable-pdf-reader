import {
  BoundedContext,
  EventListener,
  Invariant,
  Policy,
} from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import { CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT } from "../../constants.ts";
import { PdfDocumentFolderDeletedEvent } from "../event/PdfDocumentFolderDeletedEvent.ts";

/**
 * A document folder is a grouping, not an owner. It may leave only once it is
 * empty; otherwise the membership cascade would drop the filings and the
 * documents would reappear under Ungrouped without being asked.
 */
@BoundedContext(CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT)
@Policy({ inject: [] })
export class PdfDocumentFolderPolicy {
  @EventListener(PdfDocumentFolderDeletedEvent, { sends: [] })
  @Invariant("Only an empty document folder can be deleted")
  onPdfDocumentFolderDeleted(event: PdfDocumentFolderDeletedEvent): void {
    const { documentCount } = event;
    if (documentCount > 0) {
      const noun = documentCount === 1 ? "document" : "documents";
      throw ErrorFactory.ofBadRequest(
        `Cannot delete document folder with ${documentCount} ${noun} inside. ` +
        `Only an empty document folder can be deleted.`,
      );
    }
  }
}
