import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "express-prisma-cqrs";
import type { FocusableStrip } from "../types.ts";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ folderId: "number", withStrips: "boolean", notes: "FocusableStrip[]" })
export class FolderDeletedEvent extends DomainEvent {
  constructor(
    readonly folderId: number,
    readonly withStrips: boolean,
    readonly notes: FocusableStrip[]
  ) {
    super();
  }
}
