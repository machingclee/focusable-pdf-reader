import { CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { PdfDocumentFolderView } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT)
@Payload({ id: "number", pdf_document_ids: "number[]", "index?": "number" })
export class AssignPdfDocumentsToFolderCommand extends Command<PdfDocumentFolderView> {
  constructor(
    readonly id: number,
    readonly pdf_document_ids: number[],
    /** Where the new documents sit. Omit it and they are appended. */
    readonly index?: number,
  ) {
    super();
  }
}
