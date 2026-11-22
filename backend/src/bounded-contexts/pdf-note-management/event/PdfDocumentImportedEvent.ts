import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ documentId: "number", contentHash: "string", filePath: "string", originalPath: "string" })
export class PdfDocumentImportedEvent extends DomainEvent {
  constructor(
    readonly documentId: number,
    readonly contentHash: string,
    readonly filePath: string,
    readonly originalPath: string,
  ) {
    super();
  }
}
