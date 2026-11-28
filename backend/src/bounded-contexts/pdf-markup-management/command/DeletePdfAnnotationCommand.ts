import { CONTEXT_PDF_MARKUP_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";

/** Remove one pin. Undo puts the same row back, under the same id. */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_MARKUP_MANAGEMENT)
@Payload({ id: "number" })
export class DeletePdfAnnotationCommand extends Command<void> {
  constructor(readonly id: number) {
    super();
  }
}
