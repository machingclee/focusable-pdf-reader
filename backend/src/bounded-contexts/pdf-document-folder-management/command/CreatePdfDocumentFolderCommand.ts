import { CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import { CreatePdfDocumentFolderBodySchema, payloadOf } from "../../../common/schemas.ts";
import type { PdfDocumentFolderView } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT)
@Payload(payloadOf(CreatePdfDocumentFolderBodySchema))
export class CreatePdfDocumentFolderCommand extends Command<PdfDocumentFolderView> {
  constructor(readonly input: z.infer<typeof CreatePdfDocumentFolderBodySchema>) {
    super();
  }
}
