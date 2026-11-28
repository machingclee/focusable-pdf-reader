/**
 * Holding the reader's place while the pages are rescaled or re-paired.
 *
 * Two changes move every page on screen — a zoom, and a layout change that puts
 * two pages side by side — and in both the reader must not be moved with them.
 * Each is therefore a request: the code that *asks* for the change records the
 * point to keep still, and this pass, which runs after the new DOM but before the
 * browser paints, puts that point back where it was.
 *
 * **A zoom** keeps a screen point still: the point under the reader's fingers for a
 * pinch, or the reader's own reading line for a column toggle. The correction is
 * applied in two steps because scroll offsets are whole pixels in some webviews: a
 * fractional correction is snapped, and snapped the same way every time, which
 * leaves the anchor a fraction of a pixel low on every toggle. One pixel is
 * invisible; the same pixel on every toggle is the page creeping. So the second
 * step measures again and takes the remainder in whole pixels.
 *
 * **A layout change** keeps a page's corner still instead: a spread that fits stays
 * centred, a spread wider than the window keeps the page's left edge, so the facing
 * page is the one beside it.
 *
 * Neither is a new place in the document, so neither is allowed to become a scroll
 * history mark (`suspendRecording`).
 *
 * One correction is about the renderer rather than the reader: after a column
 * toggle this webview can keep painting the pages at the size and offset they had
 * before it, leaving the page area blank until something scrolls the scroller —
 * the column opening or closing reads as the PDF disappearing. A real scroll is
 * what repaints it, so one is made (`nudgePaint`): two pixels on the next frame and
 * back on the one after, which nobody can see, and only while the reader has not
 * scrolled in the meantime. The reader's own zoom has no such problem.
 */
import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { PageLayout } from "../../pageLayout";
import type { ScrollerPlace } from "./useScrollerPlace";
import { panAndScroll, type PanPoint } from "../../zoomPan";

/**
 * The screen point a zoom holds still: where it was, on which page, and where on
 * that page — the space the correction is applied in.
 */
export type ZoomAnchor = {
  clientX: number;
  clientY: number;
  page: number;
  fracX: number;
  fracY: number;
};

/** Two pixels: enough to make the webview repaint, small enough to be invisible. */
const PAINT_NUDGE_PX = 2;

export type ScrollAnchorOptions = {
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** The point a zoom must keep still, written when the zoom is applied. */
  zoomAnchorRef: RefObject<ZoomAnchor | null>;
  /** The page corner a layout change must keep still, written before the change. */
  layoutAnchorRef: RefObject<{ page: number; top: number; left: number } | null>;
  /** Set when the zoom that is landing was the viewer's answer to a layout change. */
  layoutZoomRef: RefObject<boolean>;
  /** The scroller's history, which neither correction may add a mark to. */
  scrollerPlace: ScrollerPlace;
  /** Write a settled offset to the history store without appending it. */
  settleScrollTop: (top: number) => void;
  /**
   * The offset the page column carries when the scroller has nowhere to go — a
   * sheet smaller than the page area, or the document's first page. Written with
   * the correction and dropped by the viewer when the reader moves some other way.
   */
  pan: RefObject<PanPoint>;
  /** Put that offset on the page column. */
  applyPan: (next: PanPoint) => void;
  /** Run after a zoom, and after a layout change. */
  trigger: { zoom: number; layout: PageLayout };
};

export function useScrollAnchor({
  scrollerRef,
  zoomAnchorRef,
  layoutAnchorRef,
  layoutZoomRef,
  scrollerPlace,
  settleScrollTop,
  pan,
  applyPan,
  trigger,
}: ScrollAnchorOptions): void {
  // Through a ref: the correction belongs to the change that asked for it, and a
  // caller passing a fresh arrow must not re-run it on every render.
  const settleLatest = useRef(settleScrollTop);
  settleLatest.current = settleScrollTop;

  useLayoutEffect(() => {
    const fromLayout = layoutZoomRef.current;
    layoutZoomRef.current = false;
    const anchor = zoomAnchorRef.current;
    const scroller = scrollerRef.current;
    if (!anchor || !scroller) return;
    zoomAnchorRef.current = null;
    const page = scroller.querySelector<HTMLElement>(`[data-page="${anchor.page}"]`);
    if (!page) return;
    // Hold the anchor by moving scrollTop. That offset change is the same
    // passage at a new zoom, so it must not become a history mark.
    scrollerPlace.suspendRecording();

    const offsetFrom = () => {
      const rect = page.getBoundingClientRect();
      return {
        x: rect.left + rect.width * anchor.fracX - anchor.clientX,
        y: rect.top + rect.height * anchor.fracY - anchor.clientY,
      };
    };
    /* The scroller takes as much of the error as its own range allows and the page
       column carries the rest. `scrollTop` is a whole-pixel offset that a webview
       may snap, so the fraction left over is not lost either: it lands in the
       column's own offset, which is a transform and keeps its fraction. That is
       also what lets a sheet smaller than the page area hold a word at all — it has
       no scrollable overflow, so before this the only possible answer was the
       middle of the sheet. */
    const moved = panAndScroll({
      error: offsetFrom(),
      scroll: { x: scroller.scrollLeft, y: scroller.scrollTop },
      limit: {
        x: scroller.scrollWidth - scroller.clientWidth,
        y: scroller.scrollHeight - scroller.clientHeight,
      },
      pan: pan.current,
    });
    scroller.scrollLeft = moved.scroll.x;
    scroller.scrollTop = moved.scroll.y;
    pan.current = moved.pan;
    applyPan(moved.pan);

    scrollerPlace.resumeRecordingSoon();

    if (!fromLayout) return;
    const settledLeft = scroller.scrollLeft;
    const settledTop = scroller.scrollTop;
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nudge = settledTop < maxTop - PAINT_NUDGE_PX ? PAINT_NUDGE_PX : -PAINT_NUDGE_PX;
    window.requestAnimationFrame(() => {
      if (!scroller.isConnected) return;
      scroller.scrollLeft = settledLeft;
      scroller.scrollTop = settledTop + nudge;
      window.requestAnimationFrame(() => {
        if (!scroller.isConnected) return;
        // The reader took over in between: this is their offset now.
        if (Math.abs(scroller.scrollTop - (settledTop + nudge)) > 1) return;
        scroller.scrollLeft = settledLeft;
        scroller.scrollTop = settledTop;
      });
    });
  }, [applyPan, layoutZoomRef, pan, scrollerPlace, scrollerRef, trigger.zoom, zoomAnchorRef]);

  useLayoutEffect(() => {
    const anchor = layoutAnchorRef.current;
    if (!anchor) return;
    layoutAnchorRef.current = null;
    const scroller = scrollerRef.current;
    const node = scroller?.querySelector<HTMLElement>(`[data-page="${anchor.page}"]`);
    if (!scroller || !node) return;
    // Putting the page back is a correction, not a new place in the document.
    scrollerPlace.suspendRecording();
    const scrollerRect = scroller.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.min(
      maxTop,
      Math.max(0, scroller.scrollTop + nodeRect.top - scrollerRect.top - anchor.top),
    );
    const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    if (maxLeft > 0) {
      const placed = node.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      scroller.scrollLeft = Math.min(
        maxLeft,
        Math.max(0, scroller.scrollLeft + placed.left - view.left - anchor.left),
      );
    }
    settleLatest.current(scroller.scrollTop);
    scrollerPlace.resumeRecordingSoon();
  }, [layoutAnchorRef, scrollerPlace, scrollerRef, trigger.layout]);
}
