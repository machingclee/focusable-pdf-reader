import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ stripId: "number", documentId: "number", pageNumber: "number" })
export class FocusableStripUpdatedEvent extends DomainEvent {
  constructor(
    readonly stripId: number,
    readonly documentId: number,
    readonly pageNumber: number,
  ) {
    super();
  }
}
