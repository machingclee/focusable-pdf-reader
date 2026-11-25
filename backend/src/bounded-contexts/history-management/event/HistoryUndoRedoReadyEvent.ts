import type { Command } from "@machingclee/express-cqrs";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";
import { CONTEXT_HISTORY_MANAGEMENT } from "../../constants.ts";

/**
 * A library command committed, and the commands that undo and redo it are ready
 * to remember.
 *
 * `undo` and `redo` are null when the step is a strip save whose folder was
 * opened by a nested command: the listener reads that draft off the session
 * history instead. The bus delivers this event only after the transaction
 * commits, so a rolled-back command never becomes an undo step.
 *
 * The event is declared here, by the context that owns the stack, but the
 * note and tag commands are the ones that emit it: a change in either context
 * joins the one Cmd+Z the reader sees.
 */
@BoundedContext(CONTEXT_HISTORY_MANAGEMENT)
@Payload({ label: "string", undo: "object | null", redo: "object | null", trashFiles: "string[]" })
export class HistoryUndoRedoReadyEvent extends DomainEvent {
  constructor(
    readonly label: string,
    readonly undo: Command<any> | null,
    readonly redo: Command<any> | null,
    readonly trashFiles: string[],
  ) {
    super();
  }
}
