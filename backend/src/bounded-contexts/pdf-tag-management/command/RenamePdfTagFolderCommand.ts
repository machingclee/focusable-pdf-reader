import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { PdfTagFolder } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({ id: "number", name: "string" })
export class RenamePdfTagFolderCommand extends Command<PdfTagFolder> {
  constructor(
    readonly id: number,
    readonly name: string,
  ) {
    super();
  }
}
