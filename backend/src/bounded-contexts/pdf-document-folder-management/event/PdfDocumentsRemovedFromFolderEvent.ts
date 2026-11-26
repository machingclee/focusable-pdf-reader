import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";
import { CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT } from "../../constants.ts";

@BoundedContext(CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT)
@Payload({ folderId: "number", documentCount: "number" })
export class PdfDocumentsRemovedFromFolderEvent extends DomainEvent {
  constructor(
    readonly folderId: number,
    readonly documentCount: number,
  ) {
    super();
  }
}
