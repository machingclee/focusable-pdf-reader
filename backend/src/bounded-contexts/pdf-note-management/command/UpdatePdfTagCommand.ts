import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { PdfTagWithCount } from "../types.ts";
import { UpdatePdfTagBodySchema, payloadOf } from "../../../common/schemas.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload(payloadOf(UpdatePdfTagBodySchema))
export class UpdatePdfTagCommand extends Command<PdfTagWithCount> {
  constructor(
    readonly id: number,
    readonly input: z.infer<typeof UpdatePdfTagBodySchema>,
  ) {
    super();
  }
}
