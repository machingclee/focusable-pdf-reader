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

/** Rendered at the card's own width, so a full-width band stays crisp. */
const MAX_TARGET_WIDTH_PX = 1600;
const MIN_TARGET_WIDTH_PX = 320;

/**
 * Device pixels to render at.
 *
 * A card spans the whole list, so a fixed size would be soft on a wide window and
 * wasteful on a narrow one. Measured from the box the canvas sits in, and
 * re-measured when the notes column changes width (see the ResizeObserver below).
 */
function targetWidthFor(canvas: HTMLCanvasElement): number {
  const cssWidth = canvas.parentElement?.clientWidth ?? 560;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const wanted = Math.round(cssWidth * dpr);
  return Math.min(MAX_TARGET_WIDTH_PX, Math.max(MIN_TARGET_WIDTH_PX, wanted));
}

/** The part of a saved strip a thumbnail needs: where the band is, in points. */
export type BandSource = {
  page_number: number;
  top: number;
  height: number;
  page_width: number;
};

export function StripThumbnail({ path, band }: { path: string; band: BandSource }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<"pending" | "ready" | "failed">("pending");

  useEffect(() => {
    const canvas = canvasRef.current;
    // The card is padded, so the canvas' parent is the box the band has to fill.
    const host = canvas?.parentElement;
    if (!canvas || !host) return;

    let cancelled = false;
    /** Bumped per paint, so a resize can abandon the paint it interrupted. */
    let generation = 0;
    let render: BandRender | null = null;
    /** Device pixels wide the canvas was last painted at; 0 until the first paint. */
    let paintedWidth = 0;
    let resizeTimer: number | undefined;

    const draw = async () => {
      const width = targetWidthFor(canvas);
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

    // The band fills the card, and the card fills whatever the notes column is
    // wide. So a resized column means the canvas is being stretched past what it
    // was painted at (soft) or squeezed (wasteful), and one repaint fixes both.
    // Ignoring small changes keeps a drag on the panel's edge from queueing a
    // render per pixel.
    const resizeObserver = new ResizeObserver(() => {
      if (paintedWidth === 0) return; // the observer above owns the first paint
      const width = targetWidthFor(canvas);
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
      <canvas ref={canvasRef} aria-hidden />
      {status === "failed" && <span className="notes-shot-fallback">p.{band.page_number}</span>}
    </span>
  );
}
