/**
 * A document's pages, floating beside the pointer that asked for them.
 *
 * It is a small reader, not a picture: pages of it line the left edge the way the
 * Pages rail lines the viewer's, and the sheet beside them holds the document
 * itself — every page, stacked and scrolled, the way a document is read. The
 * scroll *is* the page turn: whichever page the top of the sheet is on is the page
 * marked in the column and counted in the bar, and the column's thumbnails and the
 * bar's arrows move that scroll rather than swapping a picture. One place says
 * which page is being read, and everything else agrees with it.
 *
 * That is why the box holds still — it is anchored where the pointer was when it
 * opened (`placePagePreview`), and only moves again if a page of another shape
 * changes its size.
 *
 * Portalled to `document.body` for the same reason a context menu is: the
 * document list scrolls and clips, and a preview left inside it would be cut off
 * at the column. Whether it is open at all is `NotesView`'s decision — it knows
 * which thumbnail the pointer is on, and gives this box a moment to be entered.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { getPreviewDocument, isCancelledRender, renderPreviewPage, type BandRender } from "../notesPreview";
import { pageAtScroll } from "../pageAtScroll";
import { clampPagePreview, placePagePreview } from "../placePagePreview";

/** CSS pixels across — double the width this preview had as a glance-only picture. */
const PREVIEW_WIDTH_PX = 440;

/**
 * Narrowest the sheet is squeezed to when a tall page has to fit a short window.
 * Below this the page stops being readable and the sheet is allowed to overrun.
 */
const MIN_SHEET_WIDTH_PX = 180;

/**
 * Room the card needs besides the sheet: the bar under it, its two borders, and
 * the gap it keeps to the window edge. Subtracted from the window height, this is
 * what a sheet may be tall — the box has to fit on screen, or the document inside
 * it could never be scrolled to its end.
 */
const CARD_CHROME_PX = 58;

/** Used when a page in the list cannot be measured yet — its CSS width. */
const PAGE_THUMB_WIDTH_PX = 62;

/** Letter's proportions, for the box before the document's first page has spoken. */
const LETTER_ASPECT = 1 / 1.294;

/** The sheet's box on screen: a page of a given shape, inside this window. */
type SheetSize = { width: number; height: number };

/**
 * How big to show a page of `aspect` (width ÷ height).
 *
 * The width is the cap the preview has always had, unless that would make the
 * card taller than the window: then the page is shown smaller, because a sheet
 * that runs off the bottom of the screen cannot be scrolled through.
 */
function sheetSize(aspect: number): SheetSize {
  const available = Math.max(240, window.innerHeight - CARD_CHROME_PX);
  const wanted = Math.round(available * aspect);
  const width = Math.min(PREVIEW_WIDTH_PX, Math.max(MIN_SHEET_WIDTH_PX, wanted));
  return { width, height: Math.round(width / aspect) };
}

export type DocumentPagePreviewProps = {
  filePath: string;
  /** Where the pointer was when the preview was asked for, in viewport pixels. */
  x: number;
  y: number;
};

/*
 * It takes no callbacks about the pointer or the focus: whether it is still wanted
 * is `NotesView`'s to decide, from where the pointer actually is — a leave event
 * fired by a repaint under a still pointer is not the reader leaving.
 */

export function DocumentPagePreview({ filePath, x, y }: DocumentPagePreviewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** The sheet: the document's pages, stacked in the one scroll container. */
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [failed, setFailed] = useState(false);
  /** The shape the document's pages are stacked at; letter until page one is read. */
  const [pageAspect, setPageAspect] = useState(LETTER_ASPECT);
  /** The sheet's box on screen; letter-shaped until page one has been measured. */
  const [sheet, setSheet] = useState<SheetSize>(() => sheetSize(LETTER_ASPECT));
  /**
   * The box, decided by the first page and then kept.
   *
   * A page of another shape is stacked at its own height inside this width instead
   * of resizing the card. A card that changed size under the pointer would slide
   * the bar out from under the very click that is turning the page, and the
   * preview would close as if the reader had moved away.
   */
  const boxRef = useRef<SheetSize | null>(null);
  /** Set once the pointer has come in: from then on the card does not move. */
  const anchoredRef = useRef(false);
  /** Where the card was last put, so a frozen one can be pushed back on screen. */
  const placedRef = useRef({ left: 0, top: 0 });
  /** The page slots in the sheet, in order — what the scroll is read against. */
  const slotsRef = useRef<HTMLElement[]>([]);
  /** The page the sheet is on, kept beside the state so the scroll handler and the
   *  arrows never disagree about it. */
  const currentRef = useRef(1);

  // Open the document once and measure its first page, which is what the box is
  // sized from: the card is as tall as a page, so a whole page fits the sheet at a
  // time and the reader scrolls between pages rather than inside one.
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setPageNumber(1);
    currentRef.current = 1;
    setPageCount(0);
    setPdf(null);
    boxRef.current = null;

    void (async () => {
      try {
        const loaded = await getPreviewDocument(filePath);
        if (cancelled) return;
        const first = await loaded.getPage(1);
        if (cancelled) return;
        const base = first.getViewport({ scale: 1 });
        const aspect = base.width / base.height;
        const box = sheetSize(aspect);
        boxRef.current = box;
        setPageAspect(aspect);
        setSheet(box);
        setPageCount(loaded.numPages);
        setPdf(loaded);
      } catch (cause) {
        if (!cancelled && !isCancelledRender(cause)) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  /** The page slots in the sheet, in order — what the scroll is read against. */
  // The slots are rebuilt whenever the document (or its page count) changes, so the
  // list the scroll is measured against is taken once the stack is in the DOM — and
  // the sheet goes back to its first page, which is where a new document starts
  // rather than the place the last one was left.
  useLayoutEffect(() => {
    const scroller = sheetRef.current;
    slotsRef.current = scroller
      ? Array.from(scroller.querySelectorAll<HTMLElement>("[data-preview-page]"))
      : [];
    if (scroller) scroller.scrollTop = 0;
  }, [pdf, pageCount]);

  /**
   * The page holding the top of the sheet, read from the scroll rather than kept
   * in state: scrolling is the page turn, so the position is the truth and the
   * column and the bar only report it.
   *
   * Read on the scroll event itself, not in a frame: a window that is not drawing
   * (hidden behind another app) still scrolls, and a mark that silently stopped
   * following would be wrong the moment the card came back. The rule itself —
   * which page a scroll position means — is `pageAtScroll`, where it is tested.
   */
  const readCurrentPage = useCallback(() => {
    const scroller = sheetRef.current;
    const slots = slotsRef.current;
    if (!scroller || slots.length === 0) return;

    const page = pageAtScroll(
      slots.length,
      (index) => slots[index]?.offsetTop ?? 0,
      { top: scroller.scrollTop, height: scroller.clientHeight, content: scroller.scrollHeight },
    );
    if (page !== currentRef.current) {
      currentRef.current = page;
      setPageNumber(page);
    }
  }, []);

  useEffect(() => {
    const scroller = sheetRef.current;
    if (!scroller) return;
    scroller.addEventListener("scroll", readCurrentPage, { passive: true });
    return () => scroller.removeEventListener("scroll", readCurrentPage);
  }, [readCurrentPage, pdf, pageCount]);

  // The box opens beside the pointer and stays there. It is placed again when a
  // page of a different shape changes the sheet's height, because a box that grew
  // off the bottom of the window has to come back onto it.
  const place = useCallback(() => {
    const node = rootRef.current;
    if (!node) return;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    // Once the pointer is inside, the position is the reader's: the card stays
    // where it was put and only comes back if a page of another shape made it too
    // big for that spot. Jumping it to the other side of the cursor would take the
    // bar out from under the click that is turning the page.
    if (anchoredRef.current) {
      const kept = clampPagePreview(
        placedRef.current.left,
        placedRef.current.top,
        width,
        height,
        viewport.width,
        viewport.height,
      );
      if (kept.left !== placedRef.current.left || kept.top !== placedRef.current.top) {
        placedRef.current = kept;
        node.style.left = `${kept.left}px`;
        node.style.top = `${kept.top}px`;
      }
      return;
    }

    const next = placePagePreview(x, y, width, height, viewport.width, viewport.height);
    placedRef.current = next;
    node.style.left = `${next.left}px`;
    node.style.top = `${next.top}px`;
  }, [x, y]);

  useLayoutEffect(() => {
    place();
  }, [place, sheet, pageCount]);

  // Closed while one of its buttons has the focus: hand the focus back rather than
  // letting it die with the element.
  useEffect(
    () => () => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && rootRef.current?.contains(focused)) focused.blur();
    },
    [],
  );

  /**
   * Put a page at the top of the sheet.
   *
   * An instant scroll, not a smooth one: the page turn is one step, and a smooth
   * scroll would report every page it passed on the way — the column would flick
   * through the document and the count would spin to say the same thing twice.
   * The page is also marked here rather than waiting for the scroll event, so a
   * click answers at once.
   */
  const turnTo = (next: number) => {
    const total = Math.max(1, pageCount);
    const target = Math.min(Math.max(1, next), total);
    const scroller = sheetRef.current;
    const page = scroller?.querySelector<HTMLElement>(`[data-preview-page="${target}"]`);
    if (scroller && page) scroller.scrollTop = page.offsetTop;
    currentRef.current = target;
    setPageNumber(target);
  };

  // The arrows step, Home and End jump, and PageUp/PageDown take a screenful —
  // the way a long document is skimmed. They work whenever the focus is anywhere
  // in the box, which is where it lands after the first click on its bar.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = {
      ArrowUp: -1,
      ArrowLeft: -1,
      ArrowDown: 1,
      ArrowRight: 1,
      PageUp: -5,
      PageDown: 5,
    };
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      turnTo(event.key === "Home" ? 1 : pageCount);
      return;
    }
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    turnTo(pageNumber + step);
  };

  return createPortal(
    <div
      ref={rootRef}
      className="notes-doc-preview"
      // Entering freezes the card where it is; from then on the reader owns its
      // position. Leaving is the caller's call — it watches the pointer's
      // coordinates, not the enter/leave pairs, which a repaint can fake.
      onMouseEnter={() => {
        anchoredRef.current = true;
      }}
      onKeyDown={onKeyDown}
    >
      {/* The body is exactly the sheet's height: that definite height is what lets
          the column beside it scroll, and what gives the sheet its own scroll
          instead of stretching the card to the document's length. */}
      <div className="notes-doc-preview-body" style={{ height: `${sheet.height}px` }}>
        {/* One page is not a document to flick through: the bar's arrows are the
            whole of its navigation. */}
        {pdf && pageCount > 1 && (
          <PageLibrary pdf={pdf} pageCount={pageCount} pageNumber={pageNumber} onPick={turnTo} />
        )}

        {/* The document: every page, stacked in the sheet's own scroll. This is
            the one scrollable box in the card, and its position is the page the
            column marks (see `readCurrentPage`). */}
        <div
          ref={sheetRef}
          className="notes-doc-preview-sheet"
          style={{ width: `${sheet.width}px`, height: `${sheet.height}px` }}
          role="group"
          // A scrollable box is reachable by keyboard: focused here, the arrows step
          // the pages through the card's own handler (see `onKeyDown`) and the rest
          // of the keys scroll the sheet the way they would anywhere.
          tabIndex={0}
          aria-label={pageCount > 0 ? `Document, ${pageCount} pages` : "Document"}
        >
          {pdf &&
            Array.from({ length: pageCount }, (_, index) => (
              <SheetPage
                key={index + 1}
                pdf={pdf}
                pageNumber={index + 1}
                scrollerRef={sheetRef}
                aspect={pageAspect}
              />
            ))}
          {!pdf && !failed && <span className="spinner notes-doc-preview-spinner" />}
          {failed && <span className="notes-doc-preview-fallback">No preview</span>}
        </div>
      </div>

      {!failed && (
        <div className="notes-doc-preview-bar" role="group" aria-label="Preview pages">
          {/* `aria-disabled` rather than `disabled`: a disabled button drops the
              focus it had, so stepping back to page one would take the keyboard
              path away for the rest of the box's life. The press is harmless —
              `turnTo` holds the page inside the document. */}
          <button
            type="button"
            className="notes-doc-preview-step"
            title="Previous page"
            aria-label="Previous page"
            aria-disabled={pageNumber <= 1}
            onClick={() => turnTo(pageNumber - 1)}
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <span className="notes-doc-preview-count">
            {pageCount > 0 ? `${pageNumber} / ${pageCount}` : "…"}
          </span>
          <button
            type="button"
            className="notes-doc-preview-step"
            title="Next page"
            aria-label="Next page"
            aria-disabled={pageCount === 0 || pageNumber >= pageCount}
            onClick={() => turnTo(pageNumber + 1)}
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

/**
 * One page of the document, in the sheet's stack.
 *
 * At the sheet's full width, with its own height from its own shape: the stack is
 * the document, so a landscape page is a short slice of it and a tall one takes
 * more than the sheet shows.
 *
 * Painted when it comes near the visible part of the scroll, and *unpainted* when
 * it leaves: a full-width page at 2× is a few megabytes of bitmap, and a book
 * scrolled from cover to cover would otherwise keep all of them. What is left when
 * the bitmap goes is the page's height, so the stack does not reflow and the reader
 * scrolling back up finds paper in the right place while the paint catches up.
 */
function SheetPage({
  pdf,
  pageNumber,
  scrollerRef,
  aspect,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** The document's page shape, for the box before this page has been painted. */
  aspect: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<"pending" | "ready" | "failed">("pending");
  /** This page's height on screen, in CSS pixels, once it has been painted once. */
  const [pageHeight, setPageHeight] = useState<number | null>(null);

  // Another document's pages are another shape and another set of bitmaps.
  useEffect(() => {
    setPageHeight(null);
    setStatus("pending");
  }, [pdf]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const slot = canvas?.parentElement;
    if (!canvas || !slot) return;

    let stopped = false;
    /** Bumped by every paint and every release: only the newest may touch the canvas. */
    let live = 0;
    let render: BandRender | null = null;

    const draw = async () => {
      const mine = ++live;
      render?.cancel();
      render = null;
      try {
        // The page's own shape sets the slot's height, so a page of another shape is
        // as tall as it is rather than as tall as the document's first page.
        const page = await pdf.getPage(pageNumber);
        if (stopped || mine !== live) return;
        const base = page.getViewport({ scale: 1 });
        // Painted at the width the stack gives it, so the page is sharp on a retina
        // screen without a second copy of that number here.
        const width = Math.max(1, Math.round(slot.clientWidth || PREVIEW_WIDTH_PX));
        setPageHeight(Math.round(width / (base.width / base.height)));

        const next = renderPreviewPage(canvas, pdf, pageNumber, width);
        render = next;
        next.promise.catch(() => undefined);
        await next.promise;
        if (stopped || mine !== live) return;
        setStatus("ready");
      } catch (cause) {
        if (!stopped && mine === live && !isCancelledRender(cause)) setStatus("failed");
      }
    };

    /** Give the bitmap back. The height stays, so nothing in the stack moves. */
    const release = () => {
      live += 1;
      render?.cancel();
      render = null;
      canvas.width = 0;
      canvas.height = 0;
      setStatus("pending");
    };

    // The sheet is the scroll container, so pages above and below the visible part
    // are clipped and stop intersecting. What is near is painted, what is left
    // behind is let go, and scrolling back paints again.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) void draw();
          else if (!stopped) release();
        }
      },
      { root: scrollerRef.current, rootMargin: "400px" },
    );
    observer.observe(slot);

    return () => {
      stopped = true;
      live += 1;
      observer.disconnect();
      render?.cancel();
    };
  }, [pdf, pageNumber, scrollerRef]);

  return (
    <div
      className={`notes-doc-preview-page-sheet is-${status}`}
      data-preview-page={pageNumber}
      // Before the first paint the height comes from the document's own shape, so
      // the stack does not grow under the reader as pages arrive.
      style={pageHeight === null ? { aspectRatio: String(aspect) } : { height: `${pageHeight}px` }}
      aria-hidden
    >
      <canvas ref={canvasRef} />
      {status === "failed" && <span className="notes-doc-preview-page-fallback">No preview</span>}
    </div>
  );
}

/**
 * The document's pages, in a column down the left edge.
 *
 * The reader's own Pages rail, shrunk: one small render per page, the page that is
 * at the top of the sheet picked out, and the column scrolling on its own so a
 * hundred pages stay a column instead of a wall. It is where a page is *chosen*;
 * the sheet beside it is where the document is read.
 */
function PageLibrary({
  pdf,
  pageCount,
  pageNumber,
  onPick,
}: {
  pdf: PDFDocumentProxy;
  pageCount: number;
  pageNumber: number;
  onPick: (page: number) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);

  // Scrolling the sheet moves the mark, and a mark that scrolled out of the column
  // has to come back: this follows the page instead of only the bar's arrows. Done
  // by hand rather than `scrollIntoView`, which would also offer to scroll the
  // window behind the floating card.
  useLayoutEffect(() => {
    const rail = railRef.current;
    const current = rail?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!rail || !current) return;
    const railBox = rail.getBoundingClientRect();
    const pageBox = current.getBoundingClientRect();
    if (pageBox.top < railBox.top) rail.scrollTop += pageBox.top - railBox.top - 6;
    else if (pageBox.bottom > railBox.bottom) rail.scrollTop += pageBox.bottom - railBox.bottom + 6;
  }, [pageNumber]);

  return (
    <div className="notes-doc-preview-library" ref={railRef} role="group" aria-label="Pages">
      {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
        <button
          key={page}
          type="button"
          // The bar is the box's keyboard path; a hundred tab stops down the side
          // of a hover preview would be a maze for anyone who got there.
          tabIndex={-1}
          className="notes-doc-preview-page"
          aria-current={page === pageNumber}
          aria-label={`Page ${page}`}
          title={`Page ${page}`}
          onClick={() => onPick(page)}
        >
          <PagePreview pdf={pdf} pageNumber={page} />
        </button>
      ))}
    </div>
  );
}

/**
 * One page in the library, painted when it comes near the visible part of the
 * column — a hundred-page document must not read a hundred pages to show a screen
 * of them.
 */
function PagePreview({ pdf, pageNumber }: { pdf: PDFDocumentProxy; pageNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<"pending" | "ready" | "failed">("pending");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let render: BandRender | null = null;

    const draw = async () => {
      // The page is painted at the width the column gives it, so it is sharp on a
      // retina screen without a second copy of that number here.
      const width = Math.max(1, Math.round(canvas.parentElement?.clientWidth || PAGE_THUMB_WIDTH_PX));
      try {
        const next = renderPreviewPage(canvas, pdf, pageNumber, width);
        render = next;
        next.promise.catch(() => undefined);
        await next.promise;
        if (!cancelled) setStatus("ready");
      } catch (cause) {
        if (!cancelled && !isCancelledRender(cause)) setStatus("failed");
      }
    };

    // The column is a scroll container, so a page scrolled out of it is clipped
    // and stops intersecting: this paints what is near, and the rest when it is
    // reached. The box is watched, not the canvas, which is hidden until painted.
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void draw();
      },
      { rootMargin: "240px" },
    );
    observer.observe(canvas.parentElement ?? canvas);

    return () => {
      cancelled = true;
      observer.disconnect();
      render?.cancel();
    };
  }, [pdf, pageNumber]);

  return (
    <span className={`notes-doc-preview-page-shot is-${status}`} aria-hidden>
      <canvas ref={canvasRef} />
    </span>
  );
}
