import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "express-prisma-cqrs";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ folderId: "number", documentId: "number", name: "string" })
export class FolderCreatedEvent extends DomainEvent {
  constructor(
    readonly folderId: number,
    readonly documentId: number,
    readonly name: string,
  ) {
    super();
  }
}
