import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

/**
 * A tag folder left the catalogue. `tagCount` is how many tags it held at the
 * moment of the delete: they keep their rows and move to Ungrouped, so the
 * count is only knowable here.
 */
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ folderId: "number", tagCount: "number" })
export class PdfTagFolderDeletedEvent extends DomainEvent {
  constructor(
    readonly folderId: number,
    readonly tagCount: number,
  ) {
    super();
  }
}
