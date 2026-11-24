/**
 * The pen on the reading strip.
 *
 * The band is already the large view of a saved strip, so a stroke is drawn
 * there, on the page, instead of on the small preview. The marks are the
 * strip's own, in PDF points: the preview paints that same list, and the page
 * paints it too.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { Highlighter } from "lucide-react";

import {
  DEFAULT_BRUSH_PT,
  MAX_BRUSH_PT,
  MIN_BRUSH_PT,
  currentBrush,
  highlightSessionId,
  horizontalMark,
  parseHighlights,
  releaseHighlightSession,
  serializeHighlights,
  setBrushSize,
  setHighlightSession,
  subscribeBrush,
  subscribeHighlightSession,
  type PagePoint,
  type StripHighlight,
} from "../stripHighlight";
import { showPageHighlightDraft } from "../pageHighlightDraft";
import type { FocusableStrip } from "../types/dto";

const STUB_PX = 10;

type PageGeom = {
  left: number;
  top: number;
  cssPerPoint: number;
  pageWidth: number;
  pageHeight: number;
};

export function FocusStripHighlight({
  strip,
  scrollerRef,
  onHighlightsChange,
}: {
  strip: FocusableStrip;
  scrollerRef: { current: HTMLElement | null };
  /** Persist the whole mark list. Rejects when the write did not land. */
  onHighlightsChange: (id: number, highlights: string) => Promise<void>;
}) {
  const [active, setActive] = useState(false);
  const armedId = useSyncExternalStore(subscribeHighlightSession, highlightSessionId, highlightSessionId);
  const sessionId = -strip.id;
  /** A note card, or another strip, already holds the pen. */
  const penBlocked = armedId !== null && armedId !== sessionId;
  const [brushPt, setBrushPt] = useState(currentBrush);
  const anchorRef = useRef<PagePoint | null>(null);
  const stubRef = useRef<HTMLDivElement | null>(null);
  /** Page box from the last press or scroll. A move must not measure it again. */
  const geomRef = useRef<PageGeom | null>(null);
  /** Where the pointer last was, in viewport px. A zoom places the stub again from here. */
  const lastPointRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const marksRef = useRef<StripHighlight[]>(parseHighlights(strip.highlights));
  const highlightsRef = useRef(strip.highlights);
  const pendingSaves = useRef(0);
  const saveChain = useRef(Promise.resolve());
  const escapeRef = useRef<() => void>(() => undefined);
  highlightsRef.current = strip.highlights;

  useEffect(() => {
    if (pendingSaves.current > 0) return;
    marksRef.current = parseHighlights(strip.highlights);
    hideDraft();
  }, [strip.highlights, strip.id]);

  const hideDraft = () => showPageHighlightDraft(strip.page_number, null);

  const measure = (): PageGeom | null => {
    const page = scrollerRef.current?.querySelector<HTMLElement>(`[data-page="${strip.page_number}"]`);
    if (!page) return null;
    const rect = page.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const pageWidth = strip.page_width > 0 ? strip.page_width : 1;
    const pageHeight = strip.page_height > 0 ? strip.page_height : 1;
    const geom = { left: rect.left, top: rect.top, cssPerPoint: rect.width / pageWidth, pageWidth, pageHeight };
    geomRef.current = geom;
    return geom;
  };

  const pointAt = (clientX: number, clientY: number): PagePoint | null => {
    const geom = geomRef.current ?? measure();
    if (!geom) return null;
    return {
      x: Math.min(geom.pageWidth, Math.max(0, (clientX - geom.left) / geom.cssPerPoint)),
      y: Math.min(geom.pageHeight, Math.max(0, (clientY - geom.top) / geom.cssPerPoint)),
    };
  };

  /** The stub follows the pointer in the same event. It stays off the page's blend group, so a move does not repaint the PDF, and it is translucent while a stroke is being drawn so the line stays readable. */
  const placeStub = (clientX: number, clientY: number) => {
    const node = stubRef.current;
    lastPointRef.current = { clientX, clientY };
    const geom = geomRef.current ?? measure();
    if (!node || !geom) return;
    const anchor = anchorRef.current;
    // The module is the brush, not this render: a key press changes it before
    // React has re-rendered, and the cursor is drawn from the subscription, not
    // from the render that follows.
    const height = Math.max(currentBrush() * geom.cssPerPoint, 1);
    let x = clientX;
    let y = clientY;
    let width = STUB_PX;
    if (anchor) {
      const ax = geom.left + anchor.x * geom.cssPerPoint;
      x = Math.min(ax, clientX);
      y = geom.top + anchor.y * geom.cssPerPoint;
      width = Math.max(Math.abs(clientX - ax), 1);
    }
    node.hidden = false;
    node.classList.toggle("is-stroke", anchor != null);
    node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    node.style.width = `${width}px`;
    node.style.height = `${height}px`;
  };

  const hideStub = () => {
    lastPointRef.current = null;
    const node = stubRef.current;
    if (node) node.hidden = true;
  };

  escapeRef.current = () => {
    if (anchorRef.current) {
      anchorRef.current = null;
      hideStub();
      hideDraft();
      return;
    }
    setActive(false);
  };

  useEffect(() => {
    if (!active) {
      anchorRef.current = null;
      geomRef.current = null;
      hideStub();
      hideDraft();
      return;
    }
    const scroller = scrollerRef.current;
    const drop = () => {
      geomRef.current = null;
    };
    scroller?.addEventListener("scroll", drop, { passive: true });
    window.addEventListener("resize", drop);
    // A zoom resizes the page under the band, and that is the box the brush is
    // measured against: throw the measurement away and lay the stub out again at
    // the pointer's last place, so the cursor thickens with the page.
    const page = scroller?.querySelector<HTMLElement>(`[data-page="${strip.page_number}"]`) ?? null;
    let observer: ResizeObserver | null = null;
    if (page) {
      observer = new ResizeObserver(() => {
        geomRef.current = null;
        const last = lastPointRef.current;
        if (last) placeStub(last.clientX, last.clientY);
      });
      observer.observe(page);
    }
    // A negative id, so this pen and the note preview's pen are two sessions
    // even when they are marking the same strip. Arming one puts the other down.
    setHighlightSession({
      id: sessionId,
      onBrush: setBrushPt,
      onEscape: () => escapeRef.current(),
      onClose: () => setActive(false),
    });
    return () => {
      scroller?.removeEventListener("scroll", drop);
      window.removeEventListener("resize", drop);
      observer?.disconnect();
      hideStub();
      hideDraft();
      releaseHighlightSession(sessionId);
    };
  }, [active, sessionId, strip.page_number]);

  /**
   * `[` and `]` change the brush with no pointer event to hang the redraw on.
   *
   * The cursor is only written from that pointer path, so without this the stub
   * keeps the thickness it was last drawn at and the new size is not seen until
   * the pointer is moved. Laid out again at the pointer's last place, which has
   * not moved at all.
   */
  useEffect(() => {
    if (!active) return;
    return subscribeBrush(() => {
      const last = lastPointRef.current;
      if (last) placeStub(last.clientX, last.clientY);
    });
    // The stub is written from this subscription, never from a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const commit = (next: StripHighlight[]) => {
    marksRef.current = next;
    const serialized = serializeHighlights(next);
    pendingSaves.current += 1;
    saveChain.current = saveChain.current.then(() =>
      onHighlightsChange(strip.id, serialized)
        .catch(() => {
          if (pendingSaves.current !== 1) return;
          marksRef.current = parseHighlights(highlightsRef.current);
        })
        .finally(() => {
          pendingSaves.current -= 1;
        }),
    );
  };

  const onCatchDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    measure();
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    anchorRef.current = point;
    placeStub(event.clientX, event.clientY);
  };

  const onCatchMove = (event: PointerEvent<HTMLSpanElement>) => {
    placeStub(event.clientX, event.clientY);
  };

  const onCatchUp = (event: PointerEvent<HTMLSpanElement>) => {
    const start = anchorRef.current;
    anchorRef.current = null;
    hideStub();
    if (!start) return;
    const end = pointAt(event.clientX, event.clientY);
    if (!end) return;
    const mark = horizontalMark(start, end.x, currentBrush());
    if (!mark) return;
    showPageHighlightDraft(strip.page_number, {
      left: Math.min(mark.x0, mark.x1),
      top: mark.y,
      width: Math.abs(mark.x1 - mark.x0),
      height: mark.size,
    });
    commit([...marksRef.current, mark]);
  };

  return (
    <>
      {active && (
        <span
          className="focus-highlight-catch"
          onPointerDown={onCatchDown}
          onPointerMove={onCatchMove}
          onPointerUp={onCatchUp}
          onPointerCancel={onCatchUp}
          onPointerLeave={() => {
            if (anchorRef.current) return;
            hideStub();
          }}
        />
      )}
      <div ref={stubRef} className="focus-highlight-stub" hidden />
      {active && (
        <label className="notes-brush focus-highlight-brush">
          <span className="notes-brush-size">{brushPt}</span>
          <input
            type="range"
            min={MIN_BRUSH_PT}
            max={MAX_BRUSH_PT}
            step={1}
            value={brushPt}
            aria-label="Brush size"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setBrushPt(setBrushSize(Number(event.target.value)))}
          />
        </label>
      )}
      <button
        type="button"
        className={`notes-pen focus-highlight-pen${active ? " is-active" : ""}`}
        aria-pressed={active}
        aria-label={active ? `Highlighting, ${brushPt} point brush` : "Highlight this strip"}
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
          if (penBlocked) return;
          anchorRef.current = null;
          hideStub();
          hideDraft();
          setActive((on) => {
            if (on) return false;
            setBrushPt(setBrushSize(DEFAULT_BRUSH_PT));
            return true;
          });
        }}
      >
        <Highlighter size={16} strokeWidth={1.75} aria-hidden />
      </button>
    </>
  );
}
