import type { CommandContext } from "@machingclee/express-cqrs";
import { HistoryStepReadyEvent } from "../event/HistoryStepReadyEvent.ts";
import { SessionHistory, type HistoryStep } from "./SessionHistory.ts";

/**
 * Queue the opposite command. The session stack receives it only after this
 * command's transaction commits (`HistoryPolicy`). A command applied by undo
 * or redo records nothing: the step it came from just changes stacks.
 */
export function recordHistory(
  context: CommandContext,
  history: SessionHistory,
  step: HistoryStep,
): void {
  if (history.isApplying()) return;
  history.abandonStripDraft();
  context.events.addTransactional(
    new HistoryStepReadyEvent(step.label, step.undo, step.redo, step.trashFiles),
  );
}
