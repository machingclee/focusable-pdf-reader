/**
 * How large a strip's preview may be drawn in the notes list, kept apart from the
 * pdf.js plumbing the renderer needs.
 *
 * A saved strip is a slice of a page, so its preview is that slice of paper. The
 * question this module answers is only "how wide may it be drawn" — the height
 * follows the band's own aspect ratio from there, which is why this one number is
 * also the card's height.
 *
 * Separate file, like `stripBand.ts` and `stripSelect.ts`, so it can be tested
 * without dragging a worker, a canvas or Vite's `?url` imports into the runner.
 */

/**
 * How far a strip may be magnified, as a multiple of its page's width.
 *
 * A page is one CSS pixel per PDF point at 100% (see the README), so a 595 pt page
 * is 595 CSS px of paper, and a Notes column a little wider than the window is
 * about two pages across. The preview is meant to be *read*, so it is allowed to
 * grow with the column: this ceiling is set wide enough that it never bites in a
 * normal window (595 pt × 3 = 1785 px of column) and only says "enough" on a very
 * wide one, where the alternative is body text at poster size.
 *
 * This is the one number to change: the drawing width, the paint size and the
 * card's height (which is the band's aspect ratio at that width) all move with it.
 * `1` shows the strip at exactly the size it was cut at; `2` is a column as wide
 * as the window on a laptop.
 */
export const PREVIEW_MAX_SCALE = 2;

/** The part of a saved strip a preview needs to know its size. */
export type PreviewPage = { page_width: number };

/**
 * The widest a preview is ever drawn, in CSS px: its page's width times
 * `PREVIEW_MAX_SCALE`.
 *
 * `null` when the row does not say how wide its page is — a hand-edited or old
 * row — which means no cap at all, rather than a guess that could shrink a real
 * strip to nothing.
 */
export function previewWidthCapPx(band: PreviewPage): number | null {
  const pageWidth = band.page_width;
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) return null;
  return pageWidth * PREVIEW_MAX_SCALE;
}
