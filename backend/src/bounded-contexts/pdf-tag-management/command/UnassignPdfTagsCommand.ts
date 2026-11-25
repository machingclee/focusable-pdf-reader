import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { DocumentTag } from "../types.ts";

/**
 * Take tags off one document.
 *
 * The handler deletes the matching `assigned_pdf_tag` rows; the junction rows
 * cascade with them. Ids the document does not carry are skipped, so a repeated
 * unassign is harmless.
 */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({ documentId: "number", pdf_tag_ids: "number[]" })
export class UnassignPdfTagsCommand extends Command<DocumentTag[]> {
  constructor(
    readonly documentId: number,
    readonly pdfTagIds: number[],
  ) {
    super();
  }
}
