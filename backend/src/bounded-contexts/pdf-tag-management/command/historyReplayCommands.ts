import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import type { PdfTag, PdfTagFolder } from "../types.ts";

/**
 * The commands the undo stack stores that are not reader actions.
 *
 * They exist only to replay a step (`Restore...` puts a row back, `Replace...`
 * puts a tag set back), so their handlers emit no domain event and record no new
 * history. The reader commands themselves live beside them and are what the
 * history entries name as undo and redo.
 */

/**
 * Put a deleted tag folder back under its original id, and the catalogue back
 * in the order it had.
 *
 * `order` is the ids of every folder, in drag order, as they were before the
 * delete. The delete renumbers the survivors so the column stays dense; undoing
 * it has to put those numbers back, not just re-create the row.
 */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({ folder: "object", order: "number[]" })
export class RestorePdfTagFolderCommand extends Command<void> {
  constructor(
    readonly folder: PdfTagFolder,
    readonly order: number[],
  ) {
    super();
  }
}

/**
 * Put a deleted tag back under its original id.
 *
 * A tag's identity is its id: redos of the commands that ran after it, and the
 * assignments that pointed at it, are commands that name that id.
 */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({ tag: "object" })
export class RestorePdfTagCommand extends Command<void> {
  constructor(readonly tag: PdfTag) {
    super();
  }
}

/**
 * Undo of a paste: give the target back exactly the tags it carried.
 *
 * A copy is a replace, so its opposite is a replace too. This is the one command
 * that can put the old set back in a single step — an unassign followed by an
 * assign would be two payloads where the history has room for one command.
 */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({ documentId: "number", pdfTagIds: "number[]" })
export class ReplaceDocumentPdfTagsCommand extends Command<void> {
  constructor(
    readonly documentId: number,
    readonly pdfTagIds: number[],
  ) {
    super();
  }
}
