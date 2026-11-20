/**
 * The maths behind parking a reading strip on a page point.
 *
 * Opening a saved strip is two decisions that have to agree: how far to scroll,
 * and where the band then sits. The band is drawn in stage coordinates, so both
 * answers are one function of the page's rectangle, the point on the page, and
 * the line the point should land on.
 *
 * Written without the DOM so the awkward cases — the first page, the last page,
 * a point that cannot reach the line — are testable.
 */

/**
 * The line a strip lands on when it is opened: a fifth of the way down the
 * stage.
 *
 * Fixed rather than "wherever the strip happens to sit on its page", so going
 * through a list of strips keeps the reading position still while the page
 * scrolls under the band. A fifth, not the middle, because the reading line
 * wants the page's context below it more than above it — and not so high that
 * the band crowds the toolbar the way a tenth would.
 */
export const STRIP_LINE_FRACTION = 1 / 5;

export type StripPlacementInput = {
  /** Height of the stage, i.e. the PDF viewport the band is drawn in. */
  stageHeight: number;
  /**
   * Where the point should land, as a fraction of the stage height. The app
   * passes `STRIP_LINE_FRACTION`; it is an input because the maths does not care
   * which line it is handed.
   */
  lineFraction: number;
  /** The page's top edge in stage coordinates, at the current scroll offset. */
  pageTop: number;
  pageHeight: number;
  /** Where the point is on that page, 0 at the top edge, 1 at the bottom. */
  fracY: number;
  /** The scroller's current offset, and the largest one it accepts. */
  scrollTop: number;
  maxScrollTop: number;
};

export type StripPlacement = {
  /** Offset to write to the scroller. */
  scrollTop: number;
  /**
   * Where the point ends up in stage coordinates after that scroll. Equal to the
   * line once the document can move; short of it at either end of the document,
   * where the scroll clamps and the band has to follow the page instead.
   */
  centerY: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function placeStripPoint(input: StripPlacementInput): StripPlacement {
  const { stageHeight, lineFraction, pageTop, pageHeight, fracY, scrollTop, maxScrollTop } = input;
  const targetY = stageHeight * lineFraction;
  const pointY = pageTop + pageHeight * fracY;
  const next = clamp(scrollTop + pointY - targetY, 0, Math.max(0, maxScrollTop));
  // Scrolling moves the page up by exactly the change in offset.
  return { scrollTop: next, centerY: pointY - (next - scrollTop) };
}
