import { Actor, BoundedContext, Query } from "@machingclee/express-cqrs";
import { CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT } from "../../constants.ts";
import type { PdfDocumentFolderView } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_DOCUMENT_FOLDER_MANAGEMENT)
export class ListPdfDocumentFoldersQuery extends Query<PdfDocumentFolderView[]> {}
