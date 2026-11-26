import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";
import { CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT } from "../../constants.ts";

/**
 * A document folder left the list. `documentCount` is how many memberships it
 * held. The policy allows only an empty folder through; the handler reads the
 * count before deleting, because the membership rows cascade with the folder.
 */
@BoundedContext(CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT)
@Payload({ folderId: "number", documentCount: "number" })
export class PdfDocumentFolderDeletedEvent extends DomainEvent {
  constructor(
    readonly folderId: number,
    readonly documentCount: number,
  ) {
    super();
  }
}
