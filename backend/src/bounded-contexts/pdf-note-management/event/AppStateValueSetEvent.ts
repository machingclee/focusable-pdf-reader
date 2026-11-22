import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "express-prisma-cqrs";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ key: "string" })
export class AppStateValueSetEvent extends DomainEvent {
  constructor(readonly key: string) {
    super();
  }
}
