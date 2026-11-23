import type { Command } from "@machingclee/express-cqrs";
import { BoundedContext, DomainEvent, Payload } from "@machingclee/express-cqrs";
import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";

/**
 * A library command committed, and its opposite command is ready to remember.
 *
 * `undo` and `redo` are null when the step is a strip save whose folder was
 * opened by a nested command: the listener reads that draft off the session
 * history instead. The bus delivers this event only after the transaction
 * commits, so a rolled-back command never becomes an undo step.
 */
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ label: "string", undo: "object | null", redo: "object | null", trashFiles: "string[]" })
export class HistoryStepReadyEvent extends DomainEvent {
  constructor(
    readonly label: string,
    readonly undo: Command<any> | null,
    readonly redo: Command<any> | null,
    readonly trashFiles: string[],
  ) {
    super();
  }
}
