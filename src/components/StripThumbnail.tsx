/**
 * One strip's thumbnail in the Notes list.
 *
 * Owns three things the list itself should not know about: the lazy trigger (a
 * row that never scrolls into view must not read a PDF), the render lifecycle
 * (cancel on unmount, so flicking through documents cannot pile up renders), and
 * the failure case — a document whose file has moved gets the page-number
 * placeholder instead of a broken image.
 *
 * It also paints the strip's saved marks over the page: the yellow strokes, and
 * the annotations pinned to that page. Both are stored in PDF points, so the same
 * yellow and the same pins sit on the words here and on the page in the viewer.
 * Placing either is the viewer's job: a card is where a strip is read, and its
 * preview carries no pen of its own.
 *
 * The marks are multiplied into the page's own canvas, not laid over it by a
 * second element with `mix-blend-mode`. That blend is a property of a stacking
 * context: the card's hover swell is a `transform`, which makes one, and WebKit
 * could lose the blend when a card was left — the yellow then painted over the
 * words instead of into the paper. Compositing in canvas has no stacking context
 * to lose, and it renders the same in every host: the docked column, the popped
 * out window and a note's own preview.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { getPreviewDocument, renderStripBand, type BandRender } from "../notesPreview";
import { previewWidthCapPx } from "../stripPreview";
import { paintAnnotationsOnPage, parseStripAnnotations, type PageAnnotation } from "../annotation";
import { parseHighlights, paintHighlightsOnPage, type StripHighlight } from "../stripHighlight";

/**
 * Fold or open a note.
 *
 * A minus folds the note, preview included. A square opens it again. The
 * control is the whole note's, at the card's top right.
 */
export function NoteFoldButton({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`notes-fold${expanded ? "" : " is-collapsed"}`}
      aria-expanded={expanded}
      aria-label={expanded ? "Collapse note" : "Expand note"}
      title={expanded ? "Collapse note" : "Expand note"}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      {expanded ? (
        <span className="notes-fold-minus" aria-hidden />
      ) : (
        <span className="notes-fold-square" aria-hidden />
      )}
    </button>
  );
}

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
  annotations = "[]",
  title,
  onOpen,
}: {
  path: string;
  band: BandSource;
  /** The strip's stored marks. Omitted on a preview that only paints the page. */
  highlights?: string;
  /**
   * The annotations on this strip's page. They belong to the document, so they are
   * handed over with the strip; a preview without them paints the page alone.
   */
  annotations?: string;
  /** What the open control announces. */
  title?: string;
  /** Click the page to open the strip. */
  onOpen?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /**
   * The page as pdf.js painted it, before any mark was laid on it.
   *
   * Marks change far more often than the page does — a highlight is toggled, a
   * note is saved somewhere else — and re-rendering the PDF for each of them
   * would flash the card. Keeping the clean page in an offscreen canvas lets the
   * composited canvas be rebuilt from it in one frame.
   */
  const cleanPageRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<"pending" | "ready" | "failed">("pending");
  const widthCap = previewWidthCapPx(band);
  /** The stored strokes, parsed once per write rather than on every paint. */
  const marks = useMemo(() => parseHighlights(highlights), [highlights]);
  const marksRef = useRef<StripHighlight[]>(marks);
  marksRef.current = marks;
  /** The pins on this page, parsed the same way and painted over the strokes. */
  const pins = useMemo(() => parseStripAnnotations(annotations), [annotations]);
  const pinsRef = useRef<PageAnnotation[]>(pins);
  pinsRef.current = pins;

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
        const pdf = await getPreviewDocument(path);
        if (cancelled || mine !== generation) return;
        const next = renderStripBand(canvas, pdf, band, width);
        render = next;
        // pdf.js rejects with a cancellation when the render is torn down (row
        // scrolled away, panel closed, document changed, column resized mid-paint).
        // The await below still reports it to the UI; this attached handler only
        // guarantees the rejection is never reported as unhandled meanwhile.
        next.promise.catch(() => undefined);
        await next.promise;
        if (cancelled || mine !== generation) return;
        // The page is painted: keep a clean copy to composite marks onto, then
        // lay this card's own marks down before the canvas is revealed.
        const clean = cleanPageRef.current ?? document.createElement("canvas");
        cleanPageRef.current = clean;
        clean.width = canvas.width;
        clean.height = canvas.height;
        clean.getContext("2d")?.drawImage(canvas, 0, 0);
        paintHighlightsOnPage(canvas, marksRef.current, band);
        paintAnnotationsOnPage(canvas, pinsRef.current, band);
        setStatus("ready");
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
   * The saved marks, multiplied into the page, and the pins drawn over them.
   *
   * The card starts again from the clean page — a mark can be removed as well as
   * added, so painting over what is already there would leave the old yellow
   * behind — and `paintHighlightsOnPage` lays the whole list on in one multiply
   * pass, so two crossing strokes are the same yellow as one. The pins come after
   * it, over the marks, the way they stand on the page in the viewer. The canvas is
   * the bitmap already on screen, so the composited result never depends on what
   * other cards are doing or on the card's own hover transform.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    const clean = cleanPageRef.current;
    if (!canvas || !clean || status !== "ready") return;
    // A repaint owns the canvas for a moment; it composites the marks itself
    // when it finishes (see `draw`), so there is nothing to do until then.
    if (clean.width !== canvas.width || clean.height !== canvas.height) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "copy";
    context.drawImage(clean, 0, 0);
    context.restore();
    paintHighlightsOnPage(canvas, marks, band);
    paintAnnotationsOnPage(canvas, pins, band);
  }, [marks, pins, status, band]);

  return (
    <span className={`notes-shot${status === "ready" ? " is-ready" : ""}`}>
      <span
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
