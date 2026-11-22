/**
 * The rules a docked column drag obeys, shared by every column in the workspace.
 *
 * "Notes of this PDF" and the event log are the same kind of surface: an aside
 * docked beside the page, taking its width from the row rather than covering it.
 * Each has a minimum width, a ceiling set by the page's own minimum, and a grab
 * edge that closes the column when it is dragged far enough shut. Only the two
 * numbers differ, so the rules live here once and each column supplies its own.
 *
 * Pure, so the interesting part — "how far in counts as shut", "how wide may it
 * get before the page loses" — is read and tested without a DOM.
 */

/**
 * Narrowest the page area may become while columns are docked beside it.
 *
 * The column does not cover the page, it takes its width: past this the two would
 * be fighting over the same pixels and the page would lose. About a page at 100%
 * zoom (595 pt) with the margins a reader needs to see its edges, so the ceiling
 * a column stops at is the point where the document is still readable next to the
 * panel about it.
 */
export const MIN_STAGE_WIDTH = 480;

/**
 * Ceiling used only when the viewer cannot be measured.
 *
 * The real ceiling is the row the page and the column split — see
 * `maxDockedWidth` — but it is measured from the DOM, and a width remembered in
 * the backend is applied before that measurement is trustworthy. This is the
 * width such a value falls back to.
 */
const UNMEASURED_PANE_MAX = 760;

/**
 * Widest a column may get: the row it shares with the page, minus the page's own
 * minimum, in px.
 *
 * `availableWidth` is the page area plus this column (what the two are dividing),
 * not the whole window: the pages rail is a third column with a width of its own
 * and has no business in this sum, and another docked column has already taken
 * its share out of the stage. Measuring the row rather than fixing a ceiling is
 * the point — a reader on a wide window wants the panel wider, and a fixed number
 * is one they can neither see nor argue with. The floor wins when the two limits
 * cross (a window too narrow for both), so the column always has a usable width.
 */
export function maxDockedWidth(availableWidth: number, minWidth: number): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return UNMEASURED_PANE_MAX;
  return Math.max(minWidth, Math.round(availableWidth - MIN_STAGE_WIDTH));
}

/**
 * Dragging a column below this closes it. Deliberately well under its minimum so
 * a few pixels of undershoot snap back to the minimum instead of closing.
 */
const CLOSE_BELOW_RATIO = 0.4;

/** The width a drag has to get under for the column to close instead of settle. */
export function closeBelow(minWidth: number): number {
  return minWidth * CLOSE_BELOW_RATIO;
}

export type DockedColumnDragResult =
  | { kind: "close" }
  | { kind: "resize"; width: number };

/**
 * What to do with the width the pointer ended on: close, or settle at a usable
 * width. `maxWidth` is the workspace's own width (`maxDockedWidth`). Restoring a
 * sane width after a close is `restoredDockedWidth`'s job, since it depends on a
 * remembered value rather than on the drag.
 */
export function resolveDockedDrag(
  width: number,
  maxWidth: number,
  minWidth: number,
): DockedColumnDragResult {
  if (width < closeBelow(minWidth)) return { kind: "close" };
  const clamped = Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
  // A close-restore could still be handed a bad remembered width; the clamp above
  // covers it, but the result must never be the collapsed width itself.
  return { kind: "resize", width: clamped };
}

/** Width to reopen at after a drag closed the column. */
export function restoredDockedWidth(
  lastGoodWidth: number,
  maxWidth: number,
  minWidth: number,
): number {
  return Math.min(maxWidth, Math.max(minWidth, Math.round(lastGoodWidth)));
}
