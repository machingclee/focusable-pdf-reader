import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({ folderId: "number", name: "string" })
export class PdfTagFolderCreatedEvent extends DomainEvent {
  constructor(
    readonly folderId: number,
    readonly name: string,
  ) {
    super();
  }
}
