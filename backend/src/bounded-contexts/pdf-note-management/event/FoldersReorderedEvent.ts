import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "express-prisma-cqrs";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ documentId: "number", folderCount: "number" })
export class FoldersReorderedEvent extends DomainEvent {
  constructor(
    readonly documentId: number,
    readonly folderCount: number,
  ) {
    super();
  }
}
