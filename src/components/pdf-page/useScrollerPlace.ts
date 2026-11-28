/**
 * Where the reader is in the document, and where they have been.
 *
 * Two questions, one scroller, and both are answered from what is on screen
 * rather than from the offsets — a spread, a zoom and a page that has just been
 * re-laid out all move the numbers under the reader:
 *
 * - **Which page is showing.** Asked on every scroll frame while a jump is not
 *   in flight, and named as the spread's first page in Two Pages, so the counter
 *   and the thumbnails agree with each other. A jump owns the answer until it has
 *   landed, which is what stops a search hit or a saved strip from reporting the
 *   page it passed over on the way.
 * - **Where the scroller has rested.** The wheel, the scrollbar and a
 *   middle-button drag all emit `scroll`; a click that jumps to a page, a search
 *   hit or a saved strip often does not: it writes `scrollTop` or calls
 *   `scrollTo`, and this webview sometimes applies that write without an event.
 *   So the event is listened for *and* the offset is sampled on a short interval;
 *   either one resets the same debounce, and the mark is the offset once it has
 *   sat still.
 *
 * A zoom correction is not a new place: while it rewrites the offset, the sample
 * follows it without recording (`suspendRecording` / `resumeRecordingSoon`).
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { LoadedPdf } from "../../pdf";
import { spreadStart, type PageLayout } from "../../pageLayout";
import { useAppDispatch } from "../../store/hooks";
import {
  clearPdfScrollPositions,
  recordPdfScrollPosition,
} from "../../store/slices/appSlice";

/**
 * How long the PDF scroller has to sit still before its vertical offset is
 * remembered. A wheel flick, a scrollbar drag and a jump to a page all move
 * `scrollTop` many times; one mark per resting place is the history worth keeping.
 */
const PDF_SCROLL_RECORD_MS = 300;

/** How long the correction's own events take to pass. */
const RECORD_RELEASE_MS = 80;

/** The top of the page area at which a page is "the one being read". */
const READING_LINE_MAX_PX = 120;
/** How close a jump has to land before its page counts as arrived. */
const JUMP_LANDED_PX = 56;

export type ScrollerPlaceOptions = {
  pdf: LoadedPdf | null;
  scrollerRef: RefObject<HTMLDivElement | null>;
  layout: PageLayout;
  /** The page a jump is waiting for; cleared here once the scroller has landed. */
  jumpingToPage: { current: number | null };
  /** Report the page the reader is on. */
  onPageShown: (page: number) => void;
  /** Re-measure when the page area's shape changes under the pages. */
  relayout: { zoom: number; railOpen: boolean; railWidth: number };
};

export type ScrollerPlace = {
  /** A correction is rewriting the offset: it is not a new place, so do not record it. */
  suspendRecording: () => void;
  /** Let recording resume once the correction's own events have passed. */
  resumeRecordingSoon: () => void;
  /** Drop any pending record — the offsets belong to another document now. */
  cancelRecording: () => void;
};

export function useScrollerPlace({
  pdf,
  scrollerRef,
  layout,
  jumpingToPage,
  onPageShown,
  relayout,
}: ScrollerPlaceOptions): ScrollerPlace {
  const dispatch = useAppDispatch();
  /** Debounce handle for {@link recordPdfScrollPosition}. Cleared on document change. */
  const recordTimer = useRef(0);
  /**
   * Set while a zoom correction rewrites `scrollTop` to hold the anchor. That
   * rewrite is not a new place in the document, so the sample skips it.
   */
  const recordingSuspended = useRef(false);
  const releaseTimer = useRef(0);

  const suspendRecording = useCallback(() => {
    recordingSuspended.current = true;
    window.clearTimeout(recordTimer.current);
    window.clearTimeout(releaseTimer.current);
  }, []);

  const resumeRecordingSoon = useCallback(() => {
    window.clearTimeout(releaseTimer.current);
    releaseTimer.current = window.setTimeout(() => {
      recordingSuspended.current = false;
    }, RECORD_RELEASE_MS);
  }, []);

  const cancelRecording = useCallback(() => {
    window.clearTimeout(recordTimer.current);
  }, []);

  // The page being read: recomputed on every scroll frame, and whenever the
  // geometry under it changes (zoom, layout, rail).
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !pdf) return;

    let frame = 0;
    const updateCurrentPage = () => {
      const pages = Array.from(scroller.querySelectorAll<HTMLElement>("[data-page]"));
      if (pages.length === 0) return;

      if (jumpingToPage.current !== null) {
        const target = pages.find((node) => Number(node.dataset.page) === jumpingToPage.current);
        const scrollerTop = scroller.getBoundingClientRect().top;
        if (target && Math.abs(target.getBoundingClientRect().top - scrollerTop) < JUMP_LANDED_PX) {
          jumpingToPage.current = null;
        } else {
          return;
        }
      }

      const scrollerRect = scroller.getBoundingClientRect();
      const anchor = scrollerRect.top + Math.min(READING_LINE_MAX_PX, scroller.clientHeight * 0.22);
      let best = Number(pages[0]?.dataset.page) || 1;
      let bestDelta = Infinity;
      for (const node of pages) {
        const rect = node.getBoundingClientRect();
        // Two Pages: a facing page scrolled off to the side is not the one on
        // screen. The leftmost page still in the window wins, then the spread's
        // first page is what the counter and the thumbnails name.
        if (layout === "two") {
          const onScreen = rect.right > scrollerRect.left + 8 && rect.left < scrollerRect.right - 8;
          if (!onScreen) continue;
        }
        const delta = Math.abs(rect.top - anchor);
        if (rect.top <= anchor && rect.bottom > anchor) {
          best = Number(node.dataset.page);
          break;
        }
        if (delta < bestDelta) {
          best = Number(node.dataset.page);
          bestDelta = delta;
        }
      }
      if (layout === "two") best = spreadStart(best, layout);
      onPageShown(best);
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateCurrentPage();
      });
    };

    updateCurrentPage();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [
    jumpingToPage,
    layout,
    onPageShown,
    pdf,
    relayout.railOpen,
    relayout.railWidth,
    relayout.zoom,
    scrollerRef,
  ]);

  // The marks the scroll history walks: one per place the scroller came to rest.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!pdf || !scroller) {
      dispatch(clearPdfScrollPositions());
      return;
    }

    // Opening a document seeds the list with wherever the scroller already is —
    // often a restored page — and drops the previous document's marks: those
    // offsets belong to a different file.
    dispatch(clearPdfScrollPositions());
    dispatch(recordPdfScrollPosition(scroller.scrollTop));

    let last = Math.round(scroller.scrollTop);
    const schedule = () => {
      window.clearTimeout(recordTimer.current);
      recordTimer.current = window.setTimeout(() => {
        if (recordingSuspended.current) return;
        dispatch(recordPdfScrollPosition(scroller.scrollTop));
      }, PDF_SCROLL_RECORD_MS);
    };
    const note = () => {
      const top = Math.round(scroller.scrollTop);
      if (recordingSuspended.current) {
        last = top;
        window.clearTimeout(recordTimer.current);
        return;
      }
      if (top === last) return;
      last = top;
      schedule();
    };

    // A frame callback pauses while this view is in the background, and a
    // `scrollTop` write often has no event at all. An interval still notices
    // the offset. The scroll listener is the prompt path when an event does fire.
    const sample = window.setInterval(note, 50);
    scroller.addEventListener("scroll", note, { passive: true });
    return () => {
      window.clearInterval(sample);
      window.clearTimeout(recordTimer.current);
      window.clearTimeout(releaseTimer.current);
      recordingSuspended.current = false;
      scroller.removeEventListener("scroll", note);
    };
  }, [dispatch, pdf, scrollerRef]);

  // A stable handle: the corrections that suspend recording list it in their
  // dependencies, and an object rebuilt every render would re-run them.
  return useMemo(
    () => ({ suspendRecording, resumeRecordingSoon, cancelRecording }),
    [cancelRecording, resumeRecordingSoon, suspendRecording],
  );
}
