/**
 * Holding the reader's word still when the scroller has nowhere to go.
 *
 * A zoom keeps one screen point still, and the viewer does that by moving the
 * scroller: `scrollTop` / `scrollLeft` are exactly the right tool while the pages
 * are bigger than the page area, because every direction can be reached.
 *
 * They are not enough at the ends. A sheet that fits the page area cannot be
 * scrolled at all — the offsets are pinned at zero — so a zoom on a word beside
 * the sheet's middle line has nothing to move: the page grows about its own
 * centre and the word slides out from under the pointer. The same happens at the
 * document's first page, where there is nothing above it to scroll to. The
 * reader is left holding a zoom that "works, but around the page's centre".
 *
 * So the correction is split in two. The scroller takes what it can, and the page
 * column carries the rest as its own offset — a translate, which nothing clamps.
 * That offset is written as a displacement in the *content's* direction while the
 * scroller's is written as an offset in the opposite one, which is the only subtle
 * part of this: `scrollTop = 100` moves the pages up by 100, and `translateY(100)`
 * moves them down by 100, so one is the other with its sign flipped.
 *
 * The offset is cumulative — a second notch of the wheel corrects against the
 * pages as the first one left them — and it is dropped by the callers when the
 * reader establishes a place some other way (a jump, Fit, another document, a
 * spread), because then the scroll is the truth again and an old offset would be
 * a page drawn off its own offset.
 *
 * Kept apart from the hook so the arithmetic can be read and tested on its own.
 */

export type PanPoint = {
  /** CSS pixels to the right. */
  x: number;
  /** CSS pixels down. */
  y: number;
};

export const NO_PAN: PanPoint = { x: 0, y: 0 };

export type PanCorrection = {
  /**
   * How far the anchored page point is from where it must be, in the units the
   * scroller's offsets are moved by: adding this to `scrollLeft` / `scrollTop`
   * puts the point back under the pointer.
   */
  error: PanPoint;
  /** The offsets the scroller is at now. */
  scroll: PanPoint;
  /** How far the scroller can go, from zero: its scrollable overflow. */
  limit: PanPoint;
  /** The offset the page column carries now. */
  pan: PanPoint;
};

export type PanResult = {
  /** The offsets to write to the scroller. */
  scroll: PanPoint;
  /** The offset to write to the page column. */
  pan: PanPoint;
};

/**
 * Split one zoom correction between the scroller and the page column.
 *
 * The scroller takes the whole error where its own range allows it, which is the
 * ordinary case. What it cannot do — because the offset would have to go negative,
 * or past its end — the column carries instead, so the anchored point lands under
 * the pointer either way.
 */
export function panAndScroll({ error, scroll, limit, pan }: PanCorrection): PanResult {
  const maxX = Math.max(0, limit.x);
  const maxY = Math.max(0, limit.y);
  const wantX = scroll.x + error.x;
  const wantY = scroll.y + error.y;
  const nextX = Math.min(maxX, Math.max(0, wantX));
  const nextY = Math.min(maxY, Math.max(0, wantY));
  // What the scroller could not do. It moves the pages by `-offset`, so the shortfall
  // is the same error with the direction the column has to take.
  const shortfallX = wantX - nextX;
  const shortfallY = wantY - nextY;
  return {
    scroll: { x: nextX, y: nextY },
    pan: { x: pan.x - shortfallX, y: pan.y - shortfallY },
  };
}
