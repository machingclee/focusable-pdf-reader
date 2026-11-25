import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Query } from "@machingclee/express-cqrs";
import type { PdfTagWithCount } from "../types.ts";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
export class ListPdfTagsQuery extends Query<PdfTagWithCount[]> { }
