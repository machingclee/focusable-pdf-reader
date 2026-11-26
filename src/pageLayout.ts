/**
 * How the open PDF is laid out.
 *
 * Single Page stacks every page in a column. Two Pages places each pair side
 * by side — page 1 with 2, 3 with 4 — and the pair is one sheet: both pages
 * take the same zoom, and Fit sizes that combined width.
 */
export type PageLayout = "single" | "two";

/**
 * Space between the two pages of a spread, in CSS px.
 * Preview lays them flush: the right page's shadow is what separates them.
 */
export const SPREAD_GAP_PX = 0;

/**
 * Air Fit leaves at the sides of the sheet, in CSS px.
 * The scroller's padding is vertical; this is the horizontal inset.
 */
export const FIT_MARGIN_PX = 72;

export function isPageLayout(value: unknown): value is PageLayout {
  return value === "single" || value === "two";
}

/** First page of the spread `page` belongs to. Single Page is the page itself. */
export function spreadStart(page: number, layout: PageLayout): number {
  if (layout !== "two" || page < 1) return page;
  return page - ((page - 1) % 2);
}

/**
 * The other page of the spread, when Two Pages has one.
 * The last page of an odd-length document is alone, so this is null.
 */
export function spreadEnd(page: number, pageCount: number, layout: PageLayout): number | null {
  if (layout !== "two") return null;
  const end = spreadStart(page, layout) + 1;
  return end <= pageCount ? end : null;
}

export function sameSpread(a: number, b: number, layout: PageLayout): boolean {
  if (layout !== "two") return a === b;
  return spreadStart(a, layout) === spreadStart(b, layout);
}

/** Pages grouped as spreads. A trailing odd page is a spread of one. */
export function pairPages<T>(pages: readonly T[]): T[][] {
  const pairs: T[][] = [];
  for (let index = 0; index < pages.length; index += 2) {
    pairs.push(pages.slice(index, index + 2));
  }
  return pairs;
}

/**
 * Zoom that fits the first spread across `clientWidth`.
 *
 * Two Pages fits both pages at one scale, with nothing between them. A document
 * with one page has nothing to put beside it.
 */
export function fitZoom(
  clientWidth: number,
  pageWidths: readonly number[],
  layout: PageLayout,
): number {
  const first = pageWidths[0];
  if (!first || first <= 0) return 1;
  const second = layout === "two" ? pageWidths[1] : undefined;
  const paired = second != null && second > 0;
  const content = first + (paired ? second : 0);
  const gap = paired ? SPREAD_GAP_PX : 0;
  return (clientWidth - FIT_MARGIN_PX - gap) / content;
}

/**
 * The reading hole's horizontal slice, in stage px, clipped to the stage.
 *
 * Two Pages draws the band on one page only. The page's box is stage-relative
 * (`pageLeft` / `pageRight`); anything past the stage edge is cut off, and a
 * page that has scrolled entirely away leaves a hole of width 0.
 */
export function pageHoleSpan(
  stageWidth: number,
  pageLeft: number,
  pageRight: number,
): { left: number; width: number } {
  const left = Math.max(0, Math.min(stageWidth, pageLeft));
  const right = Math.max(0, Math.min(stageWidth, pageRight));
  return { left, width: Math.max(0, right - left) };
}
