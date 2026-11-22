import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Query, Payload } from "express-prisma-cqrs";
import type { FocusableStripWithDocument } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ filter: "FocusableStripFilter" }, {
  FocusableStripFilter: {
    "pdfDocumentId?": "number",
    "pageNumber?": "number",
    "unfiled?": "boolean",
  },
})
export class ListFocusableStripsQuery extends Query<FocusableStripWithDocument[]> {
  constructor(
    readonly filter: {
      pdfDocumentId?: number;
      pageNumber?: number;
      unfiled?: boolean;
    } = {},
  ) {
    super();
  }
}
