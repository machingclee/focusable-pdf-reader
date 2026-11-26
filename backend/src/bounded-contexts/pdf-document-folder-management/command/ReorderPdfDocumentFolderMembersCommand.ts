import { CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { PdfDocumentFolderView } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT)
@Payload({ id: "number", pdf_document_ids: "number[]" })
export class ReorderPdfDocumentFolderMembersCommand extends Command<PdfDocumentFolderView> {
  constructor(
    readonly id: number,
    readonly pdf_document_ids: number[],
  ) {
    super();
  }
}
