import {
  BoundedContext,
  EventListener,
  Invariant,
  Policy,
} from "@machingclee/express-cqrs";
import { CONTEXT_PDF_NOTES_MANAGEMENT } from "../../constants.ts";
import { HistoryAppliedEvent } from "../event/HistoryAppliedEvent.ts";
import { HistoryStepReadyEvent } from "../event/HistoryStepReadyEvent.ts";
import { RemoveCreatedStripCommand } from "../command/historyReplayCommands.ts";
import { RestoreCreatedStripCommand } from "../command/historyReplayCommands.ts";
import { SessionHistory } from "../history/SessionHistory.ts";
import { plainFolder, plainStrip } from "../history/rows.ts";

/**
 * The session stack is filled here, after the transaction that made the change
 * has committed. Applying an undo or redo does not push a new step: the command
 * that was stored just moves to the other stack.
 */
@BoundedContext(CONTEXT_PDF_NOTES_MANAGEMENT)
@Policy({ inject: [SessionHistory] })
export class HistoryPolicy {
  constructor(private readonly history: SessionHistory) { }

  @EventListener(HistoryStepReadyEvent, { sends: [] })
  @Invariant("A committed library command remembers the command that undoes it")
  async onHistoryStepReady(event: HistoryStepReadyEvent): Promise<void> {
    if (this.history.isApplying()) {
      this.history.abandonStripDraft();
      return;
    }

    const draft = this.history.closeStripDraft();
    if (draft) {
      const strip = plainStrip(draft.assigned ?? draft.strip);
      await this.history.push({
        label: "Create strip",
        undo: new RemoveCreatedStripCommand(strip.id, draft.createdFolder?.id ?? null),
        redo: new RestoreCreatedStripCommand(
          draft.createdFolder ? plainFolder(draft.createdFolder) : null,
          strip,
        ),
        trashFiles: [],
      });
      return;
    }

    if (!event.undo || !event.redo) return;
    await this.history.push({
      label: event.label,
      undo: event.undo,
      redo: event.redo,
      trashFiles: event.trashFiles,
    });
  }

  @EventListener(HistoryAppliedEvent, { sends: [] })
  @Invariant("Undo and redo move the step to the other stack")
  onHistoryApplied(event: HistoryAppliedEvent): void {
    this.history.commitApply(event.direction);
  }
}
