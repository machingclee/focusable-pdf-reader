/**
 * The first page of a document, at the left of its row in the Documents rail.
 *
 * It is the row's own preview, drawn from the file rather than stored: the rail
 * is a shelf of documents, and a name alone does not tell an OCPP spec from a
 * meeting note. Rendering it here — same cache, same renderer as the strips
 * beside it — means nothing extra is written down when a PDF is opened, and a
 * re-read of the first page is all it takes to refresh one.
 *
 * Owns the three things the rail should not know about: the lazy trigger (a row
 * below the fold must not read a PDF), the render lifecycle (cancel on unmount,
 * so flicking through documents cannot pile up paints), and the failure case — a
 * file that moved gets a dashed placeholder instead of a broken picture.
 *
 * The page is painted once, at the width the row gives it: a thumbnail is a mark
 * in a list, not a picture to read, so it has no resize observer and never
 * repaints. Resting on it is what asks for the readable version — the box
 * `DocumentPagePreview` floats beside the pointer.
 */
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { FileText } from "lucide-react";
import { getPreviewDocument, isCancelledRender, renderPreviewPage, type BandRender } from "../notesPreview";

/** Used when the box cannot be measured yet — the CSS width of `.notes-doc-thumb`. */
const FALLBACK_WIDTH_PX = 44;

export function DocumentThumbnail({
  filePath,
  onMouseEnter,
}: {
  filePath: string;
  /**
   * Hovering the sheet is what asks for the larger preview. It lives here rather
   * than on the row so the name and the date stay a plain highlight: the icon is
   * the thing that says "this is a document", so it is the thing that opens it.
   * Nothing listens for leaving — the rail works out whether the pointer is still
   * on the sheet from its coordinates (see `DashboardView`).
   */
  onMouseEnter?: (event: MouseEvent<HTMLSpanElement>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<"pending" | "ready" | "failed">("pending");

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;

    let cancelled = false;
    let render: BandRender | null = null;

    const draw = async () => {
      // The box is the picture's size: the CSS width decides how many device
      // pixels the page is painted at, so the sheet is sharp on a retina screen
      // without the component carrying a second copy of the number.
      const width = Math.max(1, Math.round(host.clientWidth || FALLBACK_WIDTH_PX));
      try {
        const pdf = await getPreviewDocument(filePath);
        if (cancelled) return;
        const next = renderPreviewPage(canvas, pdf, 1, width);
        render = next;
        // pdf.js rejects with a cancellation when a paint is torn down; this
        // handler only keeps that rejection out of the console meanwhile — the
        // await below still reports it, and the flags tell "stopped" from "broken".
        next.promise.catch(() => undefined);
        await next.promise;
        if (!cancelled) setStatus("ready");
      } catch (cause) {
        if (!cancelled && !isCancelledRender(cause)) setStatus("failed");
      }
    };

    // A row further down the list should not cost a read until it is near the
    // viewport; `rootMargin` starts the work slightly early, the way the strip
    // cards' own observer does, so scrolling does not reveal empty boxes.
    // The box is what is watched, not the canvas: an unpainted canvas is hidden
    // (see `.notes-doc-thumb:not(.is-ready) canvas`), and an element that is not
    // rendered never intersects — watching it would wait for the very paint this
    // is meant to start.
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void draw();
      },
      { rootMargin: "300px" },
    );
    observer.observe(host);

    return () => {
      cancelled = true;
      observer.disconnect();
      render?.cancel();
    };
  }, [filePath]);

  return (
    <span className={`notes-doc-thumb is-${status}`} aria-hidden onMouseEnter={onMouseEnter}>
      <canvas ref={canvasRef} />
      {status === "failed" && <FileText className="notes-doc-thumb-fallback" size={17} />}
    </span>
  );
}
