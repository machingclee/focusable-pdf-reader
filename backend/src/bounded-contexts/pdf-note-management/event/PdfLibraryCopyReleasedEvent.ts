import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

/**
 * The document delete committed, so its library copy may leave the disk.
 *
 * Published after the transaction. A refusal rolls the row back and this event
 * is never sent, which keeps the file beside the row that is still there.
 */
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ filePath: "string" })
export class PdfLibraryCopyReleasedEvent extends DomainEvent {
  constructor(readonly filePath: string) {
    super();
  }
}
