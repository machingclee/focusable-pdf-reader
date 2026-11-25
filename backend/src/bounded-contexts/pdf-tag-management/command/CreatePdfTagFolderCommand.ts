import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { PdfTagFolder } from "../types.ts";
import { CreatePdfTagFolderBodySchema, payloadOf } from "../../../common/schemas.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload(payloadOf(CreatePdfTagFolderBodySchema))
export class CreatePdfTagFolderCommand extends Command<PdfTagFolder> {
  constructor(readonly input: z.infer<typeof CreatePdfTagFolderBodySchema>) {
    super();
  }
}
