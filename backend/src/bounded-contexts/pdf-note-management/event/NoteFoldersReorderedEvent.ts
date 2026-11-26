import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ documentId: "number", folderCount: "number" })
export class NoteFoldersReorderedEvent extends DomainEvent {
  constructor(
    readonly documentId: number,
    readonly folderCount: number,
  ) {
    super();
  }
}
