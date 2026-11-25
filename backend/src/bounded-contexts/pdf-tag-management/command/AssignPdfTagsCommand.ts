import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { DocumentTag } from "../types.ts";

/**
 * Put tags on one document.
 *
 * The handler creates one `assigned_pdf_tag` per tag plus its junction row, the
 * same shape the reference project's `AssignTagToScriptHandler` writes. The
 * command is idempotent: tags already on the document are skipped, because the
 * reader's Save is a diff that may be retried.
 */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({ documentId: "number", pdf_tag_ids: "number[]" })
export class AssignPdfTagsCommand extends Command<DocumentTag[]> {
  constructor(
    readonly documentId: number,
    readonly pdfTagIds: number[],
  ) {
    super();
  }
}
