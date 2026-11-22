import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ documentCount: "number" })
export class PdfDocumentsReorderedEvent extends DomainEvent {
  constructor(readonly documentCount: number) {
    super();
  }
}
