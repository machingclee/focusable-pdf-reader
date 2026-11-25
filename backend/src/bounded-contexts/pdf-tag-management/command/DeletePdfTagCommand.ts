import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";

@Actor("Reader")
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({ id: "number" })
export class DeletePdfTagCommand extends Command<void> {
  constructor(readonly id: number) {
    super();
  }
}
