/**
 * The Dashboard tab's own split: how wide the Documents rail may be.
 *
 * The seam between the two panes is a grab edge like the docked columns' (see
 * `dockedColumn.ts`), but it divides the tab with a second list rather than with
 * the page, so it has rules of its own: it never closes (it is the only way to
 * pick a document), it keeps the notes beside it their minimum, and it never
 * grows past half the tab however wide the window is.
 *
 * Pure, so "how narrow may it get" and "how much may it take" are read and
 * tested without a DOM.
 */

/** Narrowest the rail keeps: a document name plus its saved time, legible. */
export const MIN_NOTES_VIEW_DOCUMENTS = 200;

/** The width the rail starts at, before anyone drags it. */
export const DEFAULT_NOTES_VIEW_DOCUMENTS = 272;

/**
 * Narrowest the notes beside the rail keep: one card and its text, which is about
 * what the tab gives them at the default split in a small window. Kept modest on
 * purpose — the rail is the pane a reader has a reason to widen, and a wider floor
 * would leave the seam nothing to do in a narrow window.
 */
export const MIN_NOTES_VIEW_STRIPS = 260;

/** Most of the tab the rail may take, so the notes are never the smaller pane. */
const RAIL_SHARE = 0.5;

/**
 * Ceiling used only when the tab cannot be measured — the first paint, before a
 * resize observer has reported. A remembered width is clamped against it, and
 * the real measurement follows, so it is a number wide enough not to bite.
 */
const UNMEASURED_MAX = 480;

/**
 * Widest the rail may get in a tab of `availableWidth` px.
 *
 * Two limits, whichever is smaller: what leaves the notes their minimum, and
 * half the tab. The floor wins when they cross (a window too narrow for both), so
 * the rail always has a usable width.
 */
export function maxNotesViewDocumentsWidth(availableWidth: number): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return UNMEASURED_MAX;
  const byNotes = Math.round(availableWidth - MIN_NOTES_VIEW_STRIPS);
  const byShare = Math.round(availableWidth * RAIL_SHARE);
  return Math.max(MIN_NOTES_VIEW_DOCUMENTS, Math.min(byNotes, byShare));
}

/**
 * A width brought inside the rules: whole pixels, never under the minimum and
 * never past the ceiling. Used for the live drag, for the width a remembered app
 * state hands back, and for a window that shrank under a rail dragged wide.
 */
export function clampNotesViewDocumentsWidth(width: number, maxWidth: number): number {
  const ceiling = Number.isFinite(maxWidth)
    ? Math.max(MIN_NOTES_VIEW_DOCUMENTS, Math.round(maxWidth))
    : UNMEASURED_MAX;
  if (!Number.isFinite(width)) return MIN_NOTES_VIEW_DOCUMENTS;
  return Math.min(ceiling, Math.max(MIN_NOTES_VIEW_DOCUMENTS, Math.round(width)));
}
