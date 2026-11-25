import {
  BoundedContext,
  EventListener,
  Invariant,
  Policy,
} from "@machingclee/express-cqrs";
import { CONTEXT_HISTORY_MANAGEMENT } from "../../constants.ts";
import {
  RemoveCreatedStripCommand,
  RestoreCreatedStripCommand,
} from "../../pdf-note-management/command/historyReplayCommands.ts";
import { plainFolder, plainStrip } from "../../pdf-note-management/snapshot/rows.ts";
import { HistoryAppliedEvent } from "../event/HistoryAppliedEvent.ts";
import { HistoryUndoRedoReadyEvent } from "../event/HistoryUndoRedoReadyEvent.ts";
import { SessionHistory } from "../service/SessionHistory.ts";

/**
 * The session stack is filled here, after the transaction that made the change
 * has committed. Applying an undo or redo does not push a new step: the command
 * that was stored just moves to the other stack.
 *
 * The steps arrive from the note and tag contexts; this policy is the only
 * writer of the stack they share.
 */
@BoundedContext(CONTEXT_HISTORY_MANAGEMENT)
@Policy({ inject: [SessionHistory] })
export class HistoryPolicy {
  constructor(private readonly history: SessionHistory) { }

  @EventListener(HistoryUndoRedoReadyEvent, { sends: [] })
  @Invariant("A committed library command remembers the command that undoes it")
  async onHistoryUndoRedoReady(event: HistoryUndoRedoReadyEvent): Promise<void> {
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
