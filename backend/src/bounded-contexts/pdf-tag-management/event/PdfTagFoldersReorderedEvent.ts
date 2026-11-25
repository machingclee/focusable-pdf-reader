import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({ folderCount: "number" })
export class PdfTagFoldersReorderedEvent extends DomainEvent {
  constructor(readonly folderCount: number) {
    super();
  }
}
