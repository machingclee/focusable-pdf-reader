import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "express-prisma-cqrs";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ documentId: "number", filePath: "string", name: "string" })
export class PdfDocumentResolvedEvent extends DomainEvent {
  constructor(
    readonly documentId: number,
    readonly filePath: string,
    readonly name: string,
  ) {
    super();
  }
}
