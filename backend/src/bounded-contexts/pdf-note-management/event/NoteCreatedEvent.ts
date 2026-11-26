import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ stripId: "number", documentId: "number", folderId: "number | null", pageNumber: "number" })
export class NoteCreatedEvent extends DomainEvent {
  constructor(
    readonly stripId: number,
    readonly documentId: number,
    readonly folderId: number | null,
    readonly pageNumber: number,
  ) {
    super();
  }
}
