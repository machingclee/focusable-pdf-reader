import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, Command, Payload } from "@machingclee/express-cqrs";

/**
 * Drop the assignment rows a deleted document left behind.
 *
 * `PdfTagPolicy` sends this when it hears `PdfDocumentDeletedEvent`, so the
 * cleanup is a reaction of the tag catalogue rather than something the document
 * delete knows about. The ids have to travel with the command: the document's
 * junction rows cascade when it goes, and an `assigned_pdf_tag` row is found only
 * by its own id, so nothing can look them up afterwards.
 */
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({ documentId: "number", assignedPdfTagIds: "number[]" })
export class DeleteAssignedPdfTagsCommand extends Command<void> {
  constructor(
    readonly documentId: number,
    readonly assignedPdfTagIds: number[],
  ) {
    super();
  }
}
