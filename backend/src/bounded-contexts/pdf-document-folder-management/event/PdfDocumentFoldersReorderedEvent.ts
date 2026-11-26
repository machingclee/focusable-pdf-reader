import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";
import { CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT } from "../../constants.ts";

@BoundedContext(CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT)
@Payload({ folderCount: "number" })
export class PdfDocumentFoldersReorderedEvent extends DomainEvent {
  constructor(readonly folderCount: number) {
    super();
  }
}
