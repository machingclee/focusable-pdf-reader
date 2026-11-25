import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

/** A tag left the catalogue. `assignmentCount` is how many documents carried it. */
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({ tagId: "number", assignmentCount: "number" })
export class PdfTagDeletedEvent extends DomainEvent {
  constructor(
    readonly tagId: number,
    readonly assignmentCount: number,
  ) {
    super();
  }
}
