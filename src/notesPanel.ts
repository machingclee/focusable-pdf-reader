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
export const MAX_NOTES_PANEL = 760;
export const DEFAULT_NOTES_PANEL = 380;

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
 * width. Restoring a sane width after a close is `restoredNotesPanelWidth`'s job,
 * since it depends on a remembered value rather than on the drag.
 */
export function resolveNotesPanelDrag(width: number): NotesPanelDragResult {
  if (width < CLOSE_NOTES_PANEL_BELOW) return { kind: "close" };
  const clamped = Math.min(MAX_NOTES_PANEL, Math.max(MIN_NOTES_PANEL, Math.round(width)));
  // A close-restore could still be handed a bad remembered width; the clamp above
  // covers it, but the result must never be the collapsed width itself.
  return { kind: "resize", width: clamped };
}

/** Width to reopen at after a drag closed the column. */
export function restoredNotesPanelWidth(lastGoodWidth: number): number {
  return Math.min(MAX_NOTES_PANEL, Math.max(MIN_NOTES_PANEL, Math.round(lastGoodWidth)));
}
