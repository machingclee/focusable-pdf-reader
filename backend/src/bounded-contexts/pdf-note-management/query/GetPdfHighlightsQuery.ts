import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Payload, Query } from "@machingclee/express-cqrs";

/** The document's marks, as the JSON list `{ page, x0, x1, y, size }`. */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ id: "number" })
export class GetPdfHighlightsQuery extends Query<string> {
  constructor(readonly id: number) {
    super();
  }
}
