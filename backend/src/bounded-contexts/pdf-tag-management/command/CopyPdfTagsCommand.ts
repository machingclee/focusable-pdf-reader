import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { DocumentTag } from "../types.ts";

/**
 * Copy one document's tags onto another, replacing what the target carried.
 *
 * The paste half of the rail's Copy tags / Paste tags pair. The source is read
 * here rather than shipped as ids from the window, so the overwrite is one
 * transaction and one decision: the target ends up carrying exactly the tags the
 * source has, with the ones it had and the source does not unassigned in the same
 * write.
 *
 * Copying a document onto itself is legal and changes nothing, which is what
 * makes a repeat of a paste harmless.
 */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({ fromDocumentId: "number", toDocumentId: "number" })
export class CopyPdfTagsCommand extends Command<DocumentTag[]> {
  constructor(
    readonly fromDocumentId: number,
    readonly toDocumentId: number,
  ) {
    super();
  }
}
