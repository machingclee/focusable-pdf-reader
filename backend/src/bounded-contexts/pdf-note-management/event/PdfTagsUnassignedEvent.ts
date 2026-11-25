import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

/** `removedCount` is what changed: ids the document did not carry are not counted. */
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ documentId: "number", removedCount: "number" })
export class PdfTagsUnassignedEvent extends DomainEvent {
  constructor(
    readonly documentId: number,
    readonly removedCount: number,
  ) {
    super();
  }
}
