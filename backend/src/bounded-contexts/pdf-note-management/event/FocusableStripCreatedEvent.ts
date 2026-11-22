import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "express-prisma-cqrs";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ stripId: "number", documentId: "number", folderId: "number", pageNumber: "number" })
export class FocusableStripCreatedEvent extends DomainEvent {
  constructor(
    readonly stripId: number,
    readonly documentId: number,
    readonly folderId: number,
    readonly pageNumber: number,
  ) {
    super();
  }
}
