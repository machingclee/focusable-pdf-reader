import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { PdfDocumentWithCount } from "../types.ts";
import { ReorderPdfDocumentsBodySchema, payloadOf } from "../../../common/schemas.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload(payloadOf(ReorderPdfDocumentsBodySchema))
export class ReorderPdfDocumentsCommand extends Command<PdfDocumentWithCount[]> {
  constructor(readonly input: z.infer<typeof ReorderPdfDocumentsBodySchema>) {
    super();
  }
}
