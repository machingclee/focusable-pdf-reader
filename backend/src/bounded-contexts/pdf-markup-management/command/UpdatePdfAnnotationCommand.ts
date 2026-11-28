import { CONTEXT_PDF_MARKUP_MANAGEMENT } from "../../constants.ts";
import type { z } from "zod";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import type { Annotation } from "../types.ts";
import { UpdateAnnotationBodySchema, payloadOf } from "../../../common/schemas.ts";

/**
 * Change one pin: what it says, or where it stands.
 *
 * The two edits travel in one command because they are one row and one history
 * step each. What a pin says is its text; where it stands is the answer to "which
 * words is this about", so moving it is a real edit — the reader picked the wrong
 * line, or the card covers the passage they are reading — and undo has to put it
 * back where it was.
 */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_MARKUP_MANAGEMENT)
@Payload({ id: "number", changes: "UpdateAnnotationBody" }, { UpdateAnnotationBody: payloadOf(UpdateAnnotationBodySchema) })
export class UpdatePdfAnnotationCommand extends Command<Annotation> {
  constructor(
    readonly id: number,
    readonly changes: z.infer<typeof UpdateAnnotationBodySchema>,
  ) {
    super();
  }
}
