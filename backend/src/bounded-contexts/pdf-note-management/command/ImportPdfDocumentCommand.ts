import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "express-prisma-cqrs";
import type { PdfDocumentWithStrips } from "../types.ts";
import { ImportDocumentBodySchema, payloadOf } from "../../../common/schemas.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload(payloadOf(ImportDocumentBodySchema))
export class ImportPdfDocumentCommand extends Command<PdfDocumentWithStrips> {
  constructor(readonly input: z.infer<typeof ImportDocumentBodySchema>) {
    super();
  }
}
