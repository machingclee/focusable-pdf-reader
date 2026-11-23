/**
 * The stroke still being drawn, painted straight onto the page.
 *
 * A drag moves on every pointer event. Keeping that box in React state would
 * redraw the whole viewer each time, so the page owns an empty mark and this
 * module writes its box. Saved marks stay in React; this is only the one that
 * has not been released yet.
 */

export type PageHighlightDraft = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const slots = new Map<number, HTMLElement>();

/** The page's live-stroke element. `null` drops it when the page goes away. */
export function bindPageHighlightDraft(page: number, node: HTMLElement | null): void {
  if (node) slots.set(page, node);
  else slots.delete(page);
}

/** Show `box` in PDF points, or hide the stroke when the pen lifts. */
export function showPageHighlightDraft(page: number, box: PageHighlightDraft | null): void {
  const node = slots.get(page);
  if (!node) return;
  if (!box || box.width <= 0 || box.height <= 0) {
    node.hidden = true;
    return;
  }
  node.hidden = false;
  node.style.setProperty("--hit-x", String(box.left));
  node.style.setProperty("--hit-y", String(box.top));
  node.style.setProperty("--hit-w", String(box.width));
  node.style.setProperty("--hit-h", String(box.height));
}
