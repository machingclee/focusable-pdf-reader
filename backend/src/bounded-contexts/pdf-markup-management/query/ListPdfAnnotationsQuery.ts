import { CONTEXT_PDF_MARKUP_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Payload, Query } from "@machingclee/express-cqrs";
import type { Annotation } from "../types.ts";

/** Every pin on a document, oldest first. A document with none is `[]`. */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_MARKUP_MANAGEMENT)
@Payload({ id: "number" })
export class ListPdfAnnotationsQuery extends Query<Annotation[]> {
  constructor(readonly id: number) {
    super();
  }
}
