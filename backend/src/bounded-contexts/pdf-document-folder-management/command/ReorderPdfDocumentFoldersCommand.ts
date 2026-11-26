import { CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import { payloadOf, ReorderPdfDocumentFoldersBodySchema } from "../../../common/schemas.ts";
import type { PdfDocumentFolderView } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT)
@Payload(payloadOf(ReorderPdfDocumentFoldersBodySchema))
export class ReorderPdfDocumentFoldersCommand extends Command<PdfDocumentFolderView[]> {
  constructor(readonly input: z.infer<typeof ReorderPdfDocumentFoldersBodySchema>) {
    super();
  }
}
