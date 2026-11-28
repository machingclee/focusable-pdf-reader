import { CONTEXT_PDF_MARKUP_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Payload, Query } from "@machingclee/express-cqrs";
import type { AnnotationWithDocument } from "../types.ts";

/**
 * One annotation, with the document it belongs to.
 *
 * A `[annotation:<id>]` reference is cross-document by design — it was copied
 * out of one note and pasted into another — so the row has to be readable on its
 * own, and it has to name enough of its PDF for the reader to be taken there.
 */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_MARKUP_MANAGEMENT)
@Payload({ id: "number" })
export class GetPdfAnnotationQuery extends Query<AnnotationWithDocument> {
  constructor(readonly id: number) {
    super();
  }
}
