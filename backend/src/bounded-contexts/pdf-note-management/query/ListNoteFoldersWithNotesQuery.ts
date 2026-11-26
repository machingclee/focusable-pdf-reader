import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Query, Payload } from "@machingclee/express-cqrs";
import type { NoteFolderWithNotes } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ pdfDocumentId: "number" })
export class ListNoteFoldersWithNotesQuery extends Query<NoteFolderWithNotes[]> {
  constructor(readonly pdfDocumentId: number) {
    super();
  }
}
