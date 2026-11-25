import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

/**
 * The assignments of a deleted document are gone.
 *
 * `deletedCount` is what changed: an id that was already gone is not counted.
 * The tags themselves stay in the catalogue with their own rows.
 */
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({ documentId: "number", deletedCount: "number" })
export class AssignedPdfTagsDeletedEvent extends DomainEvent {
  constructor(
    readonly documentId: number,
    readonly deletedCount: number,
  ) {
    super();
  }
}
