import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";
import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { HistoryDirection } from "../history/SessionHistory.ts";

/**
 * An undo or redo command committed. The listener moves that step to the other stack.
 */
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ direction: "string" })
export class HistoryAppliedEvent extends DomainEvent {
  constructor(readonly direction: HistoryDirection) {
    super();
  }
}
