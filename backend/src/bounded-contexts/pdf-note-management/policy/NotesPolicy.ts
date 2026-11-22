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

@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Policy()
export class NotesPolicy {
  @EventListener(FocusableStripUpdatedEvent)
  @Invariant("This is testing some rule, if I throw exception here, everything rollback")
  onFocusableStripUpdated(event: FocusableStripUpdatedEvent): void {

    // throw new Error("I am error and it should rollback the transaction");

    console.error(
      `[notes] strip=${event.stripId} document=${event.documentId} ` +
      `page=${event.pageNumber} requestId=${currentRequestId() ?? "-"}`,
    );
  }
}
