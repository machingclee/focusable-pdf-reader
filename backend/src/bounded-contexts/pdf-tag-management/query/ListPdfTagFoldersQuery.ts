import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Query } from "@machingclee/express-cqrs";
import type { PdfTagFolder } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
export class ListPdfTagFoldersQuery extends Query<PdfTagFolder[]> { }
