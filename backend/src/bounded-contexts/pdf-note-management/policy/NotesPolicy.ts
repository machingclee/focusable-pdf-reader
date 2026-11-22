import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
/**
 * Note-specific reaction to a strip update.
 *
 * The note itself lives on `focusable_strip.remark` and is committed by the
 * update command. This policy is the extension point for note projections,
 * exports or notifications that must run in the same transaction as the update.
 */

import {
  BoundedContext,
  EventListener,
  Invariant,
  Policy,
  currentRequestId,
} from "@machingclee/express-cqrs";
import { FocusableStripUpdatedEvent } from "../event/FocusableStripUpdatedEvent.ts";
import { FolderDeletedEvent } from "../event/FolderDeletedEvent.ts";
import { ErrorFactory } from "../../../common/http.ts";
import { DeleteFolderCommand } from "../command/DeleteFolderCommand.ts";
import { CreateFolderCommand } from "../command/CreateFolderCommand.ts";

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Policy()
export class NotesPolicy {
  @EventListener(FolderDeletedEvent, { sends: [CreateFolderCommand] })
  @Invariant("Nonempty folder (still with notes) cannot be deleted")
  onFolderDeleted(event: FolderDeletedEvent): void {
    const { notesRemaining } = event;
    if (notesRemaining > 0) {
      throw ErrorFactory.ofBadRequest(`Cannot delete folder with ${notesRemaining} notes remaining.`);
    }
  }
}
