import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({ tagId: "number", name: "string" })
export class PdfTagCreatedEvent extends DomainEvent {
  constructor(
    readonly tagId: number,
    readonly name: string,
  ) {
    super();
  }
}
