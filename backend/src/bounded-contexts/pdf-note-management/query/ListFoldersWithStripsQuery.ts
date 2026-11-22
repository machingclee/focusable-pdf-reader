import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Query, Payload } from "@machingclee/express-cqrs";
import type { FolderWithStrips } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ pdfDocumentId: "number" })
export class ListFoldersWithStripsQuery extends Query<FolderWithStrips[]> {
  constructor(readonly pdfDocumentId: number) {
    super();
  }
}
