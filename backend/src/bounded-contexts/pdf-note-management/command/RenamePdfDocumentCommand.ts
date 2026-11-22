import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { PdfDocument } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ id: "number", name: "string" })
export class RenamePdfDocumentCommand extends Command<PdfDocument> {
  constructor(
    readonly id: number,
    readonly name: string,
  ) {
    super();
  }
}
