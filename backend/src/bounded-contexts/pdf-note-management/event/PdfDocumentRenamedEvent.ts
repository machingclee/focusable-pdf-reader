import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "express-prisma-cqrs";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ documentId: "number", name: "string" })
export class PdfDocumentRenamedEvent extends DomainEvent {
  constructor(
    readonly documentId: number,
    readonly name: string,
  ) {
    super();
  }
}
