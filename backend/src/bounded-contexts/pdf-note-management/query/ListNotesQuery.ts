import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Query, Payload } from "@machingclee/express-cqrs";
import type { NoteWithDocument } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ filter: "NoteFilter" }, {
  NoteFilter: {
    "pdfDocumentId?": "number",
    "pageNumber?": "number",
    "unfiled?": "boolean",
  },
})
export class ListNotesQuery extends Query<NoteWithDocument[]> {
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
