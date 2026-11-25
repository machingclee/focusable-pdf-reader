import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

/**
 * A document left the library.
 *
 * `stripCount` is how many strips it held, because the cascade removes them
 * with the document and no later read can count them. `assignedPdfTagIds` is the
 * same kind of snapshot: its junction rows cascade too, so the assignments that
 * must follow the document are only knowable before the delete, and
 * `PdfTagPolicy` deletes them from these ids.
 */
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({
  documentId: "number",
  stripCount: "number",
  remainingNotes: "number",
  assignedPdfTagIds: "number[]",
})
export class PdfDocumentDeletedEvent extends DomainEvent {
  constructor(
    readonly documentId: number,
    readonly stripCount: number,
    readonly remainingNotes: number,
    readonly assignedPdfTagIds: number[],
  ) {
    super();
  }
}
