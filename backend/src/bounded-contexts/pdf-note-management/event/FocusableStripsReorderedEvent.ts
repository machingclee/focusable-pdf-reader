import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "express-prisma-cqrs";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ groupCount: "number", stripCount: "number" })
export class FocusableStripsReorderedEvent extends DomainEvent {
  constructor(
    readonly groupCount: number,
    readonly stripCount: number,
  ) {
    super();
  }
}
