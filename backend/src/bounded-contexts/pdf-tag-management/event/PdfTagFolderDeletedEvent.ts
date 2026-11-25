import { CONTEXT_PDF_TAG_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

/**
 * A tag folder left the catalogue. `tagCount` is how many tags it held at the
 * moment of the delete. `PdfTagPolicy` allows only an empty folder through; the
 * handler still captures the count before deleting, because the tags' `ON DELETE
 * SET NULL` folder reference leaves nothing to count afterwards.
 */
@BoundedContext(CONTEXT_PDF_TAG_MANAGEMENT)
@Payload({ folderId: "number", tagCount: "number" })
export class PdfTagFolderDeletedEvent extends DomainEvent {
  constructor(
    readonly folderId: number,
    readonly tagCount: number,
  ) {
    super();
  }
}
