/**
 * The decision a notes-column drag makes when the pointer is released.
 *
 * Kept out of the component because it is the part worth pinning down: the
 * column can be widened, narrowed, snapped back to its minimum, or closed by
 * dragging it shut, and "how far in counts as shut" is a rule rather than a
 * layout detail. Pure, so it is tested directly.
 */

/** Narrowest width the column keeps; below this a drag either snaps back or closes. */
export const MIN_NOTES_PANEL = 260;
export const DEFAULT_NOTES_PANEL = 380;

/**
 * Narrowest the page area may become while the column is docked beside it.
 *
 * The column does not cover the page any more, it takes its width: past this the
 * two would be fighting over the same pixels and the page would lose. About a
 * page at 100% zoom (595 pt) with the margins a reader needs to see its edges, so
 * the ceiling the column stops at is the point where the document is still
 * readable next to the notes about it.
 */
export const MIN_STAGE_WIDTH = 480;

/**
 * Ceiling used only when the viewer cannot be measured.
 *
 * The real ceiling is the row the page and the column split — see
 * `maxNotesPanelWidth` — but it is measured from the DOM, and a width remembered
 * in the backend is applied before that measurement is trustworthy. This is the
 * width such a value falls back to.
 */
const UNMEASURED_PANEL_MAX = 760;

/**
 * Widest the column may get: the row it shares with the page, minus the page's
 * own minimum, in px.
 *
 * `availableWidth` is the page area plus the column (what the two are dividing),
 * not the whole window: the pages rail is a third column with a width of its own
 * and has no business in this sum. Measuring the row rather than fixing a ceiling
 * is the point — a reader on a wide window wants the notes wider, and a fixed
 * number is one they can neither see nor argue with. The floor wins when the two
 * limits cross (a window too narrow for both), so the column always has a usable
 * width.
 */
export function maxNotesPanelWidth(availableWidth: number): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return UNMEASURED_PANEL_MAX;
  return Math.max(MIN_NOTES_PANEL, Math.round(availableWidth - MIN_STAGE_WIDTH));
}

/**
 * Dragging below this closes the column. Deliberately well under the minimum so
 * a few pixels of undershoot snap back to the minimum instead of closing.
 */
export const CLOSE_NOTES_PANEL_BELOW = MIN_NOTES_PANEL * 0.4;

export type NotesPanelDragResult =
  | { kind: "close" }
  | { kind: "resize"; width: number };

/**
 * What to do with the width the pointer ended on: close, or settle at a usable
 * width. `maxWidth` is the workspace's own width (`maxNotesPanelWidth`). Restoring
 * a sane width after a close is `restoredNotesPanelWidth`'s job, since it depends
 * on a remembered value rather than on the drag.
 */
export function resolveNotesPanelDrag(width: number, maxWidth: number): NotesPanelDragResult {
  if (width < CLOSE_NOTES_PANEL_BELOW) return { kind: "close" };
  const clamped = Math.min(maxWidth, Math.max(MIN_NOTES_PANEL, Math.round(width)));
  // A close-restore could still be handed a bad remembered width; the clamp above
  // covers it, but the result must never be the collapsed width itself.
  return { kind: "resize", width: clamped };
}

/** Width to reopen at after a drag closed the column. */
export function restoredNotesPanelWidth(lastGoodWidth: number, maxWidth: number): number {
  return Math.min(maxWidth, Math.max(MIN_NOTES_PANEL, Math.round(lastGoodWidth)));
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
