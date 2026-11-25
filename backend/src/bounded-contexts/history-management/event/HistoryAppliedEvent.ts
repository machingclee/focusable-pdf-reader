import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";
import { CONTEXT_HISTORY_MANAGEMENT } from "../../constants.ts";
import type { HistoryDirection } from "../service/SessionHistory.ts";

/**
 * An undo or redo command committed. The listener moves that step to the other stack.
 */
@BoundedContext(CONTEXT_HISTORY_MANAGEMENT)
@Payload({ direction: "string" })
export class HistoryAppliedEvent extends DomainEvent {
  constructor(readonly direction: HistoryDirection) {
    super();
  }
}
