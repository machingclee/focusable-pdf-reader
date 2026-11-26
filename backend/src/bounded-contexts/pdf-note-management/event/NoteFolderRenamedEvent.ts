import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ folderId: "number", documentId: "number", name: "string" })
export class NoteFolderRenamedEvent extends DomainEvent {
  constructor(
    readonly folderId: number,
    readonly documentId: number,
    readonly name: string,
  ) {
    super();
  }
}
