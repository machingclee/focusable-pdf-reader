/**
 * Where a pointer is, on the paper.
 *
 * Everything the viewer draws over a page is stored in PDF points — marks,
 * annotations, the reading strip — while the pointer, the scroller and the stage
 * all speak screen pixels. These are the conversions between the two: which page
 * a point is over, where on that page it fell, and where a point locked to a page
 * lands in the stage's own coordinates once the page has scrolled.
 *
 * Read from what is on screen rather than from the scroller's arithmetic, so a
 * two-page spread, a zoomed page and a pin's own overlay all answer the same way.
 */
import { clamp } from "./clamp";

/** Strip center locked to a page so it rides scroll / zoom. */
export type ContentLock = {
  page: number;
  fracY: number;
};

export function pageElementAtPoint(
  scroller: HTMLElement | null,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  if (!scroller) return null;
  const pages = scroller.querySelectorAll<HTMLElement>("[data-page]");
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const node of pages) {
    const rect = node.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      return node;
    }
    const nearestX = clamp(clientX, rect.left, rect.right);
    const nearestY = clamp(clientY, rect.top, rect.bottom);
    const dist = Math.hypot(clientX - nearestX, clientY - nearestY);
    if (dist < bestDist) {
      best = node;
      bestDist = dist;
    }
  }
  return best;
}

export function contentLockAtPoint(
  scroller: HTMLElement | null,
  clientX: number,
  clientY: number,
): ContentLock | null {
  const page = pageElementAtPoint(scroller, clientX, clientY);
  if (!page) return null;
  const rect = page.getBoundingClientRect();
  return {
    page: Number(page.dataset.page) || 1,
    fracY: rect.height ? (clientY - rect.top) / rect.height : 0.5,
  };
}

export function stageYFromContentLock(
  stage: HTMLElement,
  scroller: HTMLElement | null,
  lock: ContentLock,
): number | null {
  const page = scroller?.querySelector<HTMLElement>(`[data-page="${lock.page}"]`);
  if (!page) return null;
  const stageRect = stage.getBoundingClientRect();
  const pageRect = page.getBoundingClientRect();
  return pageRect.top - stageRect.top + lock.fracY * pageRect.height;
}

/**
 * The page drawn under a viewport point, or null off the paper.
 *
 * Asked of what is actually on screen rather than of the scroller's arithmetic, so
 * a two-page spread, a zoomed page and a pin's own overlay all answer the same way.
 * The first `.page-shell` in the stack wins: that is the topmost page there.
 */
export function pageShellAt(clientX: number, clientY: number): HTMLElement | null {
  if (typeof document === "undefined") return null;
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    if (!(node instanceof Element)) continue;
    const shell = node.closest(".page-shell");
    if (shell instanceof HTMLElement) return shell;
  }
  return null;
}

/** A viewport point put back into a page's own coordinates. */
export type PagePointHit = {
  /** 1-based page under the pointer. */
  page: number;
  /** The point in PDF points, `y` from the top of that page. */
  point: { x: number; y: number };
  /** The page's size in PDF points, for clamping. */
  pageWidth: number;
  pageHeight: number;
};

/**
 * The page under a viewport point, and where that point is on it.
 *
 * The page's own size is read off the shell's `--page-w` / `--page-h`, which is the
 * size every mark on it is stored in, so the answer is in the space the pins live
 * in whatever the zoom is. One lookup, used by both the drag and the clamp.
 */
export function pagePointAt(clientX: number, clientY: number): PagePointHit | null {
  const shell = pageShellAt(clientX, clientY);
  if (!shell) return null;
  const page = Number.parseInt(shell.dataset.page ?? "", 10);
  const rect = shell.getBoundingClientRect();
  const pageWidth = Number.parseFloat(shell.style.getPropertyValue("--page-w"));
  const pageHeight = Number.parseFloat(shell.style.getPropertyValue("--page-h"));
  if (!Number.isInteger(page) || rect.width <= 0 || rect.height <= 0) return null;
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) return null;
  if (!Number.isFinite(pageHeight) || pageHeight <= 0) return null;
  const perPoint = rect.width / pageWidth;
  return {
    page,
    pageWidth,
    pageHeight,
    point: { x: (clientX - rect.left) / perPoint, y: (clientY - rect.top) / perPoint },
  };
}
