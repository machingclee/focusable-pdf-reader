/**
 * The first page of a document, floating at the pointer.
 *
 * Portalled to `document.body` for the same reason a context menu is: the
 * document list scrolls and clips, and a preview left inside it would be cut
 * off at the column. The box takes no pointer events, so it can sit beside the
 * cursor without stealing the hover that keeps it open.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getPreviewDocument, renderPreviewPage, type BandRender } from "../notesPreview";
import { placePagePreview } from "../placePagePreview";

/** CSS pixels across. A letter page then stands a little under 290px tall. */
const PREVIEW_WIDTH_PX = 220;

export type DocumentPagePreviewHandle = {
  /** Move the box so it stays just clear of the pointer. */
  place: (x: number, y: number) => void;
};

function isCancelledRender(cause: unknown): boolean {
  return Boolean(cause && typeof cause === "object" && "name" in cause && cause.name === "RenderingCancelledException");
}

export const DocumentPagePreview = forwardRef<
  DocumentPagePreviewHandle,
  { filePath: string; x: number; y: number }
>(function DocumentPagePreview({ filePath, x, y }, ref) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const point = useRef({ x, y });
    const [status, setStatus] = useState<"pending" | "ready" | "failed">("pending");

    const placeAt = useCallback((nextX: number, nextY: number) => {
      point.current = { x: nextX, y: nextY };
      const node = rootRef.current;
      if (!node) return;
      const next = placePagePreview(
        nextX,
        nextY,
        node.offsetWidth,
        node.offsetHeight,
        window.innerWidth,
        window.innerHeight,
      );
      node.style.left = `${next.left}px`;
      node.style.top = `${next.top}px`;
    }, []);

    useImperativeHandle(ref, () => ({ place: placeAt }), [placeAt]);

    // First paint, and again once the page has a real height: a letter sheet is
    // taller than the empty placeholder, and the box has to move with that.
    useLayoutEffect(() => {
      placeAt(point.current.x, point.current.y);
    }, [placeAt, status]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      let cancelled = false;
      let render: BandRender | null = null;

      void (async () => {
        try {
          const pdf = await getPreviewDocument(filePath);
          if (cancelled) return;
          render = renderPreviewPage(canvas, pdf, 1, PREVIEW_WIDTH_PX);
          render.promise.catch(() => undefined);
          await render.promise;
          if (!cancelled) setStatus("ready");
        } catch (cause) {
          if (!cancelled && !isCancelledRender(cause)) setStatus("failed");
        }
      })();

      return () => {
        cancelled = true;
        render?.cancel();
      };
    }, [filePath]);

    return createPortal(
      <div ref={rootRef} className="notes-doc-preview" aria-hidden>
        <div className={`notes-doc-preview-sheet${status === "ready" ? " is-ready" : ""}`}>
          <canvas ref={canvasRef} />
          {status === "pending" && <span className="spinner is-on-paper notes-doc-preview-spinner" />}
          {status === "failed" && <span className="notes-doc-preview-fallback">No preview</span>}
        </div>
      </div>,
      document.body,
    );
  },
);
