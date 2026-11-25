import type { CommandContext } from "@machingclee/express-cqrs";
import { HistoryUndoRedoReadyEvent } from "../event/HistoryUndoRedoReadyEvent.ts";
import { SessionHistory, type HistoryStep } from "./SessionHistory.ts";

/**
 * Queue a step's undo and redo commands. The session stack receives them only
 * after this command's transaction commits (`HistoryPolicy`). A command applied
 * by undo or redo records nothing: the step it came from just changes stacks.
 *
 * This is the seam the other contexts use: a note or tag handler calls it, and
 * the event it queues is declared by the history context.
 */
export function recordHistory(
  context: CommandContext,
  history: SessionHistory,
  step: HistoryStep,
): void {
  if (history.isApplying()) return;
  history.abandonStripDraft();
  context.events.addTransactional(
    new HistoryUndoRedoReadyEvent(step.label, step.undo, step.redo, step.trashFiles),
  );
}
