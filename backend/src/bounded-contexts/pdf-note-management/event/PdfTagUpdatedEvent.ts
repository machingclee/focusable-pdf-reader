import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ tagId: "number", name: "string" })
export class PdfTagUpdatedEvent extends DomainEvent {
  constructor(
    readonly tagId: number,
    readonly name: string,
  ) {
    super();
  }
}
