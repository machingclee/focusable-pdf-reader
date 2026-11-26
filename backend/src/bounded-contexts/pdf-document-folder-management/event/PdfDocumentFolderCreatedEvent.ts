import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";
import { CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT } from "../../constants.ts";

@BoundedContext(CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT)
@Payload({ folderId: "number", name: "string" })
export class PdfDocumentFolderCreatedEvent extends DomainEvent {
  constructor(
    readonly folderId: number,
    readonly name: string,
  ) {
    super();
  }
}
