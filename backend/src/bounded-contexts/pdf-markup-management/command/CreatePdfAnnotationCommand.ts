import { CONTEXT_PDF_MARKUP_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { Annotation } from "../types.ts";
import { CreateAnnotationBodySchema, payloadOf } from "../../../common/schemas.ts";

/**
 * Pin a new piece of text to a page of a document.
 *
 * The document is in the path, the pin is in the body: it is placed where the
 * reader clicked, in PDF points, so the same mark lands on the same words at any
 * zoom.
 */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_MARKUP_MANAGEMENT)
@Payload({ id: "number", annotation: "CreateAnnotationBody" }, { CreateAnnotationBody: payloadOf(CreateAnnotationBodySchema) })
export class CreatePdfAnnotationCommand extends Command<Annotation> {
  constructor(
    readonly id: number,
    readonly annotation: z.infer<typeof CreateAnnotationBodySchema>,
  ) {
    super();
  }
}
