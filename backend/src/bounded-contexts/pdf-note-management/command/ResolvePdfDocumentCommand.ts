import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { PdfDocumentWithNotes } from "../types.ts";
import { ResolveDocumentBodySchema, payloadOf } from "../../../common/schemas.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload(payloadOf(ResolveDocumentBodySchema))
export class ResolvePdfDocumentCommand extends Command<PdfDocumentWithNotes> {
  constructor(readonly input: z.infer<typeof ResolveDocumentBodySchema>) {
    super();
  }
}
