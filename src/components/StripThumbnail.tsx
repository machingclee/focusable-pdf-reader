/**
 * One strip's thumbnail in the Notes list.
 *
 * Owns three things the list itself should not know about: the lazy trigger (a
 * row that never scrolls into view must not read a PDF), the render lifecycle
 * (cancel on unmount, so flicking through documents cannot pile up renders), and
 * the failure case — a document whose file has moved gets the page-number
 * placeholder instead of a broken image.
 *
 * When the list hands it a strip id, it also owns the pen. The pen sits in the
 * upper right corner of the preview. A drag lays a yellow horizontal stroke
 * and the release ends it; `[` and `]` change how thick that stroke is. The
 * marks are stored on the strip, in PDF points, so the same strokes sit on the
 * words in this preview and on the page in the viewer.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { Highlighter } from "lucide-react";
import { getPreviewDocument, renderStripBand, type BandRender } from "../notesPreview";
import { previewWidthCapPx } from "../stripPreview";
import {
  DEFAULT_BRUSH_PT,
  MAX_BRUSH_PT,
  MIN_BRUSH_PT,
  brushPreviewBox,
  currentBrush,
  fillMergedHighlights,
  highlightBoxes,
  highlightSessionId,
  horizontalMark,
  parseHighlights,
  pointOnBand,
  previewScale,
  releaseHighlightSession,
  serializeHighlights,
  setBrushSize,
  setHighlightSession,
  subscribeHighlightSession,
  type PagePoint,
  type StripHighlight,
} from "../stripHighlight";

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
  stripId,
  title,
  onOpen,
  onHighlightsChange,
}: {
  path: string;
  band: BandSource;
  /** The strip's stored marks. Omitted on a preview that only paints the page. */
  highlights?: string;
  /** Set when this preview may grow its own marks. */
  stripId?: number;
  /** What the open control announces. */
  title?: string;
  /** Click the page, with the pen up, to open the strip. */
  onOpen?: () => void;
  /** Persist the whole mark list. Rejects when the write did not land. */
  onHighlightsChange?: (highlights: string) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const markCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageRef = useRef<HTMLSpanElement | null>(null);
  const [status, setStatus] = useState<"pending" | "ready" | "failed">("pending");
  const [cssWidth, setCssWidth] = useState(0);
  const [active, setActive] = useState(false);
  const [brushPt, setBrushPt] = useState(currentBrush);
  const [marks, setMarks] = useState<StripHighlight[]>(() => parseHighlights(highlights));
  const widthCap = previewWidthCapPx(band);
  const canMark = stripId != null && onHighlightsChange != null;
  const armedId = useSyncExternalStore(subscribeHighlightSession, highlightSessionId, highlightSessionId);
  /** Another card or the reading strip already holds the pen. This button stays shut until that one is put down. */
  const penBlocked = canMark && armedId !== null && armedId !== stripId;
  const highlightsRef = useRef(highlights);
  const marksRef = useRef(marks);
  const pendingSaves = useRef(0);
  const saveChain = useRef(Promise.resolve());
  const anchorRef = useRef<PagePoint | null>(null);
  const stubRef = useRef<HTMLDivElement | null>(null);
  /** Where the pointer is, in the page's layout pixels. Not state: the stub is the cursor, and a render would leave it a frame behind. */
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const brushRef = useRef(brushPt);
  const escapeRef = useRef<() => void>(() => undefined);
  highlightsRef.current = highlights;
  marksRef.current = marks;
  brushRef.current = brushPt;

  useEffect(() => {
    if (pendingSaves.current > 0) return;
    setMarks(parseHighlights(highlights));
  }, [highlights]);

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
    if (!active || stripId == null) return;
    setHighlightSession({
      id: stripId,
      onBrush: setBrushPt,
      onEscape: () => escapeRef.current(),
      onClose: () => setActive(false),
    });
    return () => releaseHighlightSession(stripId);
  }, [active, stripId]);

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
   * Saved marks on the multiply canvas, and the stroke under the pointer on its
   * own see-through stub.
   *
   * Called from the pointer event itself. Waiting for a state update painted the
   * stub on the next frame, which is the lag the cursor had once the pen was down.
   * The stub is not painted into the multiply canvas: that yellow is opaque, and
   * on top of the preview it hides the line being marked.
   */
  const paintMarks = () => {
    const canvas = markCanvasRef.current;
    const page = pageRef.current;
    const stub = stubRef.current;
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
    fillMergedHighlights(context, highlightBoxes(marksRef.current, band, width));
    const cursor = cursorRef.current;
    if (!stub) return;
    if (!cursor) {
      stub.hidden = true;
      return;
    }
    const scale = previewScale(width, band.page_width);
    const box = brushPreviewBox(cursor.x, cursor.y, anchorRef.current, brushRef.current, band.top, scale);
    stub.hidden = false;
    stub.classList.toggle("is-stroke", anchorRef.current != null);
    stub.style.transform = `translate3d(${box.left}px, ${box.top}px, 0)`;
    stub.style.width = `${box.width}px`;
    stub.style.height = `${box.height}px`;
  };

  escapeRef.current = () => {
    if (anchorRef.current) {
      anchorRef.current = null;
      paintMarks();
      return;
    }
    cursorRef.current = null;
    setActive(false);
  };

  const togglePen = () => {
    if (penBlocked) return;
    anchorRef.current = null;
    cursorRef.current = null;
    setActive((on) => {
      if (on) return false;
      setBrushPt(setBrushSize(DEFAULT_BRUSH_PT));
      return true;
    });
  };

  const commit = (next: StripHighlight[]) => {
    if (!onHighlightsChange) return;
    marksRef.current = next;
    setMarks(next);
    const serialized = serializeHighlights(next);
    pendingSaves.current += 1;
    // One write at a time, each carrying the list so far, so a slow first save
    // cannot land after a later one and drop the stroke that followed it.
    saveChain.current = saveChain.current.then(() =>
      onHighlightsChange(serialized)
        .catch(() => {
          if (pendingSaves.current !== 1) return;
          const reverted = parseHighlights(highlightsRef.current);
          marksRef.current = reverted;
          setMarks(reverted);
        })
        .finally(() => {
          pendingSaves.current -= 1;
        }),
    );
  };

  const pointFromEvent = (event: PointerEvent<HTMLSpanElement>) => {
    const page = pageRef.current;
    if (!page) return null;
    // Offset into the catch, which covers the page. No box measurement: that
    // read forced a layout on every move, and the stub then waited on it.
    const local = { x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY };
    const scale = previewScale(page.clientWidth, band.page_width);
    return { local, point: pointOnBand(local.x, local.y, band.top, scale) };
  };

  const onCatchDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const hit = pointFromEvent(event);
    if (!hit) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    anchorRef.current = hit.point;
    cursorRef.current = hit.local;
    paintMarks();
  };

  const onCatchMove = (event: PointerEvent<HTMLSpanElement>) => {
    const hit = pointFromEvent(event);
    if (!hit) return;
    cursorRef.current = hit.local;
    paintMarks();
  };

  const onCatchUp = (event: PointerEvent<HTMLSpanElement>) => {
    const start = anchorRef.current;
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    const hit = pointFromEvent(event);
    anchorRef.current = null;
    if (hit) cursorRef.current = hit.local;
    paintMarks();
    if (!hit) return;
    const mark = horizontalMark(start, hit.point.x, currentBrush());
    if (mark) commit([...marksRef.current, mark]);
  };

  useEffect(() => {
    paintMarks();
    // The pointer paints itself. This only redraws when the marks, the brush,
    // or the page size change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, brushPt, cssWidth, status, band, active]);

  return (
    <span className={`notes-shot${status === "ready" ? " is-ready" : ""}${active ? " is-highlighting" : ""}`}>
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
        <div ref={stubRef} className="notes-highlight-stub" hidden />
        {onOpen && (
          <button
            type="button"
            className="notes-shot-hit"
            title={title}
            aria-label={title || "Open this strip"}
            onClick={() => {
              if (active) return;
              onOpen();
            }}
          />
        )}
        {active && (
          <span
            className="notes-highlight-catch"
            onPointerDown={onCatchDown}
            onPointerMove={onCatchMove}
            onPointerUp={onCatchUp}
            onPointerCancel={onCatchUp}
            onPointerLeave={() => {
              if (anchorRef.current) return;
              cursorRef.current = null;
              paintMarks();
            }}
          />
        )}
      </span>
      {status === "failed" && <span className="notes-shot-fallback">p.{band.page_number}</span>}
      {canMark && status === "ready" && active && (
        <label className="notes-brush">
          <span className="notes-brush-size">{brushPt}</span>
          <input
            type="range"
            min={MIN_BRUSH_PT}
            max={MAX_BRUSH_PT}
            step={1}
            value={brushPt}
            aria-label="Brush size"
            title="Brush size"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setBrushPt(setBrushSize(Number(event.target.value)))}
          />
        </label>
      )}
      {canMark && status === "ready" && (
        <button
          type="button"
          className={`notes-pen${active ? " is-active" : ""}`}
          aria-pressed={active}
          aria-label={active ? `Highlighting, ${brushPt} point brush` : "Highlight this preview"}
          title={
            penBlocked
              ? "Finish the highlight already open"
              : active
                ? `${brushPt} pt · drag across the line · [ ] brush size · Esc cancels`
                : "Highlight"
          }
          disabled={penBlocked}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            togglePen();
          }}
        >
          <Highlighter size={16} strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </span>
  );
}

