/**
 * One strip's thumbnail in the Notes list.
 *
 * Owns three things the list itself should not know about: the lazy trigger (a
 * row that never scrolls into view must not read a PDF), the render lifecycle
 * (cancel on unmount, so flicking through documents cannot pile up renders), and
 * the failure case — a document whose file has moved gets the page-number
 * placeholder instead of a broken image.
 *
 * It also paints the strip's saved marks over the page. The strokes are stored on
 * the strip in PDF points, so the same yellow sits on the words here and on the
 * page in the viewer. Placing a stroke is the viewer's job: a card is where a
 * strip is read, and its preview carries no pen of its own.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { getPreviewDocument, renderStripBand, type BandRender } from "../notesPreview";
import { previewWidthCapPx } from "../stripPreview";
import { fillMergedHighlights, highlightBoxes, parseHighlights } from "../stripHighlight";

/** Ceilings on the paint size, so a huge column cannot ask for a huge canvas. */
const MAX_TARGET_WIDTH_PX = 1600;
const MIN_TARGET_WIDTH_PX = 320;

/** The part of a saved strip a thumbnail needs: where the band is, in points. */
export type BandSource = {
  page_number: number;
  top: number;
  height: number;
  page_width: number;
};

/**
 * Device pixels to render at.
 *
 * A card spans the whole list, so a fixed size would be soft on a wide window and
 * wasteful on a narrow one. Measured from the box the canvas sits in, and
 * re-measured when the notes column changes width (see the ResizeObserver below)
 * — then held to `previewWidthCapPx`, because the column width past the cap is
 * never drawn on.
 */
function targetWidthFor(canvas: HTMLCanvasElement, capPx: number | null): number {
  const cssWidth = canvas.parentElement?.clientWidth ?? 560;
  const shown = capPx === null ? cssWidth : Math.min(cssWidth, capPx);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const wanted = Math.round(shown * dpr);
  return Math.min(MAX_TARGET_WIDTH_PX, Math.max(MIN_TARGET_WIDTH_PX, wanted));
}

export function StripThumbnail({
  path,
  band,
  highlights = "[]",
  title,
  onOpen,
}: {
  path: string;
  band: BandSource;
  /** The strip's stored marks. Omitted on a preview that only paints the page. */
  highlights?: string;
  /** What the open control announces. */
  title?: string;
  /** Click the page to open the strip. */
  onOpen?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const markCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageRef = useRef<HTMLSpanElement | null>(null);
  const [status, setStatus] = useState<"pending" | "ready" | "failed">("pending");
  const [cssWidth, setCssWidth] = useState(0);
  const widthCap = previewWidthCapPx(band);
  /** The stored strokes, parsed once per write rather than on every paint. */
  const marks = useMemo(() => parseHighlights(highlights), [highlights]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const measure = () => setCssWidth(page.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    // The card is padded, so the canvas' parent is the box the band has to fill.
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    /** Widest this band is ever drawn: `PREVIEW_MAX_SCALE` × its page width. */
    const capPx = previewWidthCapPx(band);

    let cancelled = false;
    /** Bumped per paint, so a resize can abandon the paint it interrupted. */
    let generation = 0;
    let render: BandRender | null = null;
    /** Device pixels wide the canvas was last painted at; 0 until the first paint. */
    let paintedWidth = 0;
    let resizeTimer: number | undefined;

    const draw = async () => {
      const width = targetWidthFor(canvas, capPx);
      const mine = ++generation;
      render?.cancel();
      render = null;
      paintedWidth = width;

      try {
        const document = await getPreviewDocument(path);
        if (cancelled || mine !== generation) return;
        const next = renderStripBand(canvas, document, band, width);
        render = next;
        // pdf.js rejects with a cancellation when the render is torn down (row
        // scrolled away, panel closed, document changed, column resized mid-paint).
        // The await below still reports it to the UI; this attached handler only
        // guarantees the rejection is never reported as unhandled meanwhile.
        next.promise.catch(() => undefined);
        await next.promise;
        if (!cancelled && mine === generation) setStatus("ready");
      } catch {
        // Cancellation lands here as well; the flags tell them apart.
        if (!cancelled && mine === generation) setStatus("failed");
      }
    };

    // Rows further down the list should not cost a render until they are near
    // the viewport. `rootMargin` starts the work slightly early so scrolling
    // does not reveal empty boxes.
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void draw();
      },
      { rootMargin: "240px" },
    );
    observer.observe(canvas);

    // The band fills the card up to its page's width, and the card fills whatever
    // the notes column is wide. So a resized column means the canvas is being
    // stretched past what it was painted at (soft) or squeezed (wasteful), and one
    // repaint fixes both — until the column passes the cap, where the band has
    // stopped changing size and there is nothing left to repaint.
    // Ignoring small changes keeps a drag on the panel's edge from queueing a
    // render per pixel.
    const resizeObserver = new ResizeObserver(() => {
      if (paintedWidth === 0) return; // the observer above owns the first paint
      const width = targetWidthFor(canvas, capPx);
      if (Math.abs(width - paintedWidth) < Math.max(48, paintedWidth * 0.15)) return;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => void draw(), 120);
    });
    resizeObserver.observe(host);

    return () => {
      cancelled = true;
      observer.disconnect();
      resizeObserver.disconnect();
      window.clearTimeout(resizeTimer);
      render?.cancel();
    };
    // The geometry is the picture. A new mark list must not repaint the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, band.page_number, band.top, band.height, band.page_width]);

  /**
   * The saved marks, on one multiply canvas over the page.
   *
   * Painted from the page's own box, so the strokes move with the words when the
   * column is resized. The multiply blend is in the stylesheet: the shapes are one
   * opaque yellow, and the blend is what lays that ink into the paper instead of
   * over it.
   */
  useEffect(() => {
    const canvas = markCanvasRef.current;
    const page = pageRef.current;
    if (!canvas || !page) return;
    const width = page.clientWidth;
    const height = page.clientHeight;
    if (width <= 0 || height <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bitmapWidth = Math.max(1, Math.round(width * dpr));
    const bitmapHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
    if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    fillMergedHighlights(context, highlightBoxes(marks, band, width));
  }, [marks, cssWidth, status, band]);

  return (
    <span className={`notes-shot${status === "ready" ? " is-ready" : ""}`}>
      <span
        ref={pageRef}
        className="notes-shot-page"
        // The strip is shown at up to `PREVIEW_MAX_SCALE` times its page's width
        // and centred in the card: past that a wider column gives the band no more
        // paper, so what grows is the white margin beside it, not the type.
        style={widthCap === null ? undefined : { maxWidth: `${widthCap}px` }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden
        />
        <canvas ref={markCanvasRef} className="notes-highlights" aria-hidden />
        {onOpen && (
          <button
            type="button"
            className="notes-shot-hit"
            title={title}
            aria-label={title || "Open this strip"}
            onClick={onOpen}
          />
        )}
      </span>
      {status === "failed" && <span className="notes-shot-fallback">p.{band.page_number}</span>}
    </span>
  );
}
