import { Actor, BoundedContext, Command, Payload } from "@machingclee/express-cqrs";
import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import type { HistoryDirection, HistoryStatus } from "../history/SessionHistory.ts";

/** Cmd+Z or Cmd+Y. The route is the only caller. */
@Actor("Reader")
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Payload({ direction: "string" })
export class ApplyHistoryCommand extends Command<HistoryStatus> {
  constructor(readonly direction: HistoryDirection) {
    super();
  }
}
