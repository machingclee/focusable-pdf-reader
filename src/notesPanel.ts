/**
 * The "Notes of this PDF" column's own numbers.
 *
 * The rules a drag obeys — the page's minimum, the ceiling, where a drag counts
 * as shut — are the same for every docked column and live in `dockedColumn.ts`.
 * What is specific to this one is how wide it starts, how narrow it may get, and
 * the message it shows when the open PDF has no file path to store notes against.
 */

import {
  closeBelow,
  maxDockedWidth,
  resolveDockedDrag,
  restoredDockedWidth,
  type DockedColumnDragResult,
} from "./dockedColumn";

export { MIN_STAGE_WIDTH } from "./dockedColumn";

/** Narrowest width the column keeps; below this a drag either snaps back or closes. */
export const MIN_NOTES_PANEL = 260;
export const DEFAULT_NOTES_PANEL = 380;

/** Widest the column may get: the row it shares with the page, minus the page's minimum. */
export function maxNotesPanelWidth(availableWidth: number): number {
  return maxDockedWidth(availableWidth, MIN_NOTES_PANEL);
}

/** Dragging below this closes the column. */
export const CLOSE_NOTES_PANEL_BELOW = closeBelow(MIN_NOTES_PANEL);

export type NotesPanelDragResult = DockedColumnDragResult;

/** What a drag on the column's edge settles on: close, or a usable width. */
export function resolveNotesPanelDrag(width: number, maxWidth: number): NotesPanelDragResult {
  return resolveDockedDrag(width, maxWidth, MIN_NOTES_PANEL);
}

/** Width to reopen at after a drag closed the column. */
export function restoredNotesPanelWidth(lastGoodWidth: number, maxWidth: number): number {
  return restoredDockedWidth(lastGoodWidth, maxWidth, MIN_NOTES_PANEL);
}

/**
 * What the column says when the open PDF has no file path.
 *
 * Shared by the docked column and its popped-out window so the two never drift:
 * a PDF dragged in from a browser lives in memory, and strips are rows against a
 * path, so there is nothing to attach a note to until it is opened from disk.
 */
export const PATHLESS_NOTES_MESSAGE =
  "This PDF was opened without a file path, so its strips cannot be stored. Open it through Open PDF to keep notes for it.";
