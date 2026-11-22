import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";

/**
 * A folder left the document.
 *
 * `noteCount` is how many notes the folder held at the moment of the delete,
 * because the cascade removes them with the folder and no later read can count
 * them.
 *
 * The event records what happened, not what was asked for: whether the delete
 * should have been allowed depends on the caller's `with_strips`, and that is
 * settled in `DeleteFolderCommandHandler` before anything is deleted. Keeping
 * the flag here as well would only invite a listener to re-decide a question the
 * handler has already answered.
 */
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ folderId: "number", noteCount: "number" })
export class FolderDeletedEvent extends DomainEvent {
  constructor(
    readonly folderId: number,
    readonly noteCount: number,
  ) {
    super();
  }
}
