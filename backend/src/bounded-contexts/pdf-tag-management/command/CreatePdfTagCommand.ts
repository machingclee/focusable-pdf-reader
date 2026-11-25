import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { PdfTagWithCount } from "../types.ts";
import { CreatePdfTagBodySchema, payloadOf } from "../../../common/schemas.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload(payloadOf(CreatePdfTagBodySchema))
export class CreatePdfTagCommand extends Command<PdfTagWithCount> {
  constructor(readonly input: z.infer<typeof CreatePdfTagBodySchema>) {
    super();
  }
}
