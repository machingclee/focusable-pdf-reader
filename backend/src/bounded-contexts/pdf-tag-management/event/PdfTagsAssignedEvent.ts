import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

/** `assignedCount` is what changed: tags already on the document are not counted. */
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({ documentId: "number", assignedCount: "number" })
export class PdfTagsAssignedEvent extends DomainEvent {
  constructor(
    readonly documentId: number,
    readonly assignedCount: number,
  ) {
    super();
  }
}
