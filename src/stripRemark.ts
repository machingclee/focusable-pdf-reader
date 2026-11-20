/**
 * The note badges: which saved strips wear one, and where on the stage it goes.
 *
 * A badge belongs to a **page**, not to the reading band. It marks the passage
 * its remark was written about, so it is there whether focus mode is on or off,
 * whether the band is parked on that strip or a page away — the editor that wrote
 * the note is long gone, and the badge is how the passage keeps saying "something
 * was written about this".
 *
 * Kept free of the DOM and React: the list is a filter and a sort, and the place
 * is one clamped coordinate, which is what makes both testable without a page, a
 * canvas or a scroller.
 */
import type { FocusableStrip } from "./types/dto";

/**
 * The saved strips that deserve a badge, in the order they are drawn: page, then
 * position on the page, then id.
 *
 * A remark that is only whitespace is no remark — the same test the notes list
 * uses to decide whether a card says "no note".
 */
export function remarkedStrips(strips: readonly FocusableStrip[]): FocusableStrip[] {
  return strips
    .filter((strip) => strip.remark.trim().length > 0)
    .sort((a, b) => a.page_number - b.page_number || a.top - b.top || a.id - b.id);
}

/** Badge width in CSS px. The stylesheet uses the same number, so the clamp below
    keeps the whole badge on screen. */
export const REMARK_MARKER_SIZE = 24;

/** Gap the badge keeps from the page's left edge — and from the stage's, when it
    is the clamp rather than the page that decided where it goes. */
export const REMARK_MARKER_INSET = 6;

/**
 * Where a badge goes horizontally, in stage px: at the left edge of its page,
 * nudged in by the inset, and clamped so it stays on screen.
 *
 * The clamp matters at the edges of a zoomed document, where the page's left edge
 * can sit left of the stage: the badge belongs to a passage that is on screen, so
 * it has to stay visible rather than be clipped away with the page's margin.
 */
export function remarkMarkerLeft(pageLeft: number, stageWidth: number): number {
  const leftmost = REMARK_MARKER_INSET;
  const rightmost = Math.max(leftmost, stageWidth - REMARK_MARKER_SIZE - leftmost);
  return Math.min(Math.max(pageLeft + REMARK_MARKER_INSET, leftmost), rightmost);
}
