/**
 * One strip's thumbnail in the Notes list.
 *
 * Owns three things the list itself should not know about: the lazy trigger (a
 * row that never scrolls into view must not read a PDF), the render lifecycle
 * (cancel on unmount, so flicking through documents cannot pile up renders), and
 * the failure case — a document whose file has moved gets the page-number
 * placeholder instead of a broken image.
 */
import { useEffect, useRef, useState } from "react";
import { getPreviewDocument, renderStripBand, type BandRender } from "../notesPreview";
import { previewWidthCapPx } from "../stripPreview";

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

export function StripThumbnail({ path, band }: { path: string; band: BandSource }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<"pending" | "ready" | "failed">("pending");
  const widthCap = previewWidthCapPx(band);

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
  }, [path, band]);

  return (
    <span className={`notes-shot${status === "ready" ? " is-ready" : ""}`}>
      <canvas
        ref={canvasRef}
        aria-hidden
        // The strip is shown at up to `PREVIEW_MAX_SCALE` times its page's width
        // and centred in the card: past that a wider column gives the band no more
        // paper, so what grows is the white margin beside it, not the type.
        // `height` stays auto, which is what keeps the band's aspect ratio (and so
        // the card's height) while the cap bites.
        style={widthCap === null ? undefined : { maxWidth: `${widthCap}px` }}
      />
      {status === "failed" && <span className="notes-shot-fallback">p.{band.page_number}</span>}
    </span>
  );
}
