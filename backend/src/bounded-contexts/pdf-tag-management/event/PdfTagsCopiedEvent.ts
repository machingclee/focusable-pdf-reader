import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

/**
 * One document's tags replaced another's.
 *
 * The counts are what changed: `removedCount` tags came off the target,
 * `assignedCount` went on. Both are zero when the two documents already carried
 * the same tags — that paste writes nothing and, like a repeated assign, sends no
 * event at all.
 */
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({
  fromDocumentId: "number",
  toDocumentId: "number",
  removedCount: "number",
  assignedCount: "number",
})
export class PdfTagsCopiedEvent extends DomainEvent {
  constructor(
    readonly fromDocumentId: number,
    readonly toDocumentId: number,
    readonly removedCount: number,
    readonly assignedCount: number,
  ) {
    super();
  }
}
