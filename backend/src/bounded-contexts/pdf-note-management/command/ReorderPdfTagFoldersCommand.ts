import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { PdfTagFolder } from "../types.ts";
import { ReorderPdfTagFoldersBodySchema, payloadOf } from "../../../common/schemas.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload(payloadOf(ReorderPdfTagFoldersBodySchema))
export class ReorderPdfTagFoldersCommand extends Command<PdfTagFolder[]> {
  constructor(readonly input: z.infer<typeof ReorderPdfTagFoldersBodySchema>) {
    super();
  }
}
