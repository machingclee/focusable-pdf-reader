import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import { CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT } from "../../constants.ts";
import type { PdfDocumentFolder } from "../types.ts";

/**
 * Put a deleted document folder back under its original id, and the list back
 * in the order it had. Used as the undo of delete and the redo of create.
 * Emits nothing and records no new history step.
 */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT)
@Payload({ folder: "object", order: "number[]" })
export class RestorePdfDocumentFolderCommand extends Command<void> {
  constructor(
    readonly folder: PdfDocumentFolder,
    readonly order: number[],
  ) {
    super();
  }
}
