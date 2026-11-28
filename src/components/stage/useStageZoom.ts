/**
 * The page area's own size, and what a change of it does to the zoom.
 *
 * The stage is measured twice for two different reasons, and the two must not be
 * confused — that confusion is what used to make the viewer flicker and the page
 * creep:
 *
 * - **A docked column opening or closing** is one change, not two. The page area
 *   narrows *and* the page scales, and both have to land in the same commit:
 *   scaling from the resize observer instead paints the narrower column at the old
 *   zoom first — the page shifts, an overflow scrollbar appears and goes, then the
 *   page shrinks. A layout effect runs after the new DOM but before the browser
 *   paints, so the page area is never shown in the state nobody asked for. The
 *   scale is anchored on the reader's place (`layoutZoomAnchor`), never the pointer.
 *
 * - **A window resize, or a column's own drag**, never comes through that path and
 *   keeps the page's size: there the reader asked for room around the same page.
 *   The observer measures those, and reports the size to whoever lays out the
 *   band and the badges.
 *
 * Both are re-run by the columns' open state because raising the event log is a
 * request for the log, not for a bigger document: the page keeps the share of the
 * area it had instead of being cut off at the same zoom.
 *
 * The same measurement owns the stage's wheel and pinch handlers, which are the
 * other way the page area changes what the reader sees.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { zoomForArea } from "../../zoomProportion";
import {
  reportedPoint,
  zoomPointFor,
  type ZoomGestureKind,
  type ZoomPoint,
} from "../../zoomPoint";

type WebKitGestureEvent = Event & {
  scale: number;
  clientX: number;
  clientY: number;
};

export type StageZoomOptions = {
  stageRef: RefObject<HTMLDivElement | null>;
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** Whether a document is open: with none, there is nothing to scale. */
  pdfOpen: boolean;
  /** The zoom as the handlers read it, without waiting for a render. */
  zoomRef: RefObject<number>;
  /**
   * Set when the next zoom change is the viewer's answer to a layout change, not
   * the reader's own zoom: only that change has to repaint the scroller afterwards.
   */
  layoutZoomRef: RefObject<boolean>;
  /** The reader's place, in stage coordinates, a layout change scales around. */
  layoutZoomAnchor: (scroller: HTMLElement) => { x: number; y: number };
  /** Scale and re-anchor the page. */
  applyZoom: (next: number, clientX: number, clientY: number) => void;
  /** The pointer's last place, the fallback anchor for a gesture with no position. */
  cursorRef: RefObject<{ x: number; y: number } | null>;
  /** The docked columns' and the tab's open state: each of them is a layout change. */
  layoutColumns: {
    eventLogOpen: boolean;
    notesPanelOpen: boolean;
    notesDetached: boolean;
    view: string;
  };
};

export type StageZoom = {
  /** The page area's measured size, for whatever lays out against it. */
  size: { width: number; height: number };
};

export function useStageZoom({
  stageRef,
  scrollerRef,
  pdfOpen,
  zoomRef,
  layoutZoomRef,
  layoutZoomAnchor,
  applyZoom,
  cursorRef,
  layoutColumns,
}: StageZoomOptions): StageZoom {
  const [size, setSize] = useState({ width: 0, height: 0 });
  /**
   * The page area's width at the last measurement, for the ratio a toggle makes.
   * A ref rather than state: it is a baseline to compare against, not something
   * the render depends on.
   */
  const laidOutWidth = useRef(0);
  /** A pinch is in flight, so its own wheel events must not zoom as well. */
  const gestureActive = useRef(false);
  const gestureStartZoom = useRef(1);

  const measure = (width: number, height: number) => {
    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  };

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const scroller = scrollerRef.current;
    if (!stage || !scroller) return;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    measure(width, height);
    /* Nothing to scale: no document, or a viewer that is not on screen — the
       Dashboard hides it, so its width reads as zero.

       The width the page was last laid out for is *not* overwritten in that case.
       The log can be raised from the Dashboard, and coming back to the PDF tab has
       to scale against the width the page still has on that tab's books: the column
       took its room while nobody was looking, so the page keeps its share exactly as
       it would have if the column had been raised with the page on screen.
       Overwriting it with zero made the next toggle scale from nothing and double
       the zoom. */
    if (!pdfOpen || width <= 0) return;
    const previous = laidOutWidth.current;
    laidOutWidth.current = width;
    if (previous <= 0) return;
    const next = zoomForArea(zoomRef.current, previous, width);
    if (Math.abs(next - zoomRef.current) < 1e-4) return;
    const point = layoutZoomAnchor(scroller);
    layoutZoomRef.current = true;
    applyZoom(next, point.x, point.y);
    // `view` is a dependency because a tab switch changes this viewer's width while
    // no column was toggled: the page has to be laid out for the area it has now.
  }, [
    applyZoom,
    layoutColumns.eventLogOpen,
    layoutColumns.notesDetached,
    layoutColumns.notesPanelOpen,
    layoutColumns.view,
    layoutZoomAnchor,
    layoutZoomRef,
    pdfOpen,
    scrollerRef,
    stageRef,
    zoomRef,
  ]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    /** Measure the page area. The column's own toggle is handled above. */
    const updateStageSize = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      // A hidden viewer measures zero, and that zero is not a width the page was
      // ever laid out for: writing it down here would throw away the baseline the
      // tab switch scales against (see the layout effect above), which is what made
      // the log look like it had always been there.
      if (width > 0) laidOutWidth.current = width;
      measure(width, height);
    };

    updateStageSize();
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(stage);

    /**
     * The point a zoom must hold still, out of what the event says and where the
     * pointer is.
     *
     * The two gestures report different things under the same name. A wheel's
     * coordinates are the pointer's, exact and current. `⌘` + wheel never arrives
     * as a wheel on this webview — it arrives as a zoom *gesture*, whose
     * coordinates are the gesture's own centre, the middle of the view — so it asks
     * the pointer instead. A trackpad pinch is the one gesture whose own point is
     * right, because there it is the fingers', and what tells the two apart is the
     * `⌘` key: the pinch has no key held. `zoomPoint` carries the rule and the rest
     * of the argument.
     */
    const pointFor = (event: Event, kind: ZoomGestureKind): ZoomPoint => {
      const rect = stage.getBoundingClientRect();
      const webkit = event as Partial<WebKitGestureEvent>;
      const mouse = event as Partial<MouseEvent>;
      return zoomPointFor({
        kind,
        eventPoint: reportedPoint(
          webkit.clientX ?? mouse.clientX,
          webkit.clientY ?? mouse.clientY,
        ),
        pointer: cursorRef.current,
        // A wheel carrying `Ctrl` is the form a trackpad's pinch takes, and a
        // gesture with no `⌘` held is the pinch itself: both are the fingers', and
        // both keep their own point. A gesture *with* `⌘` held is this viewer's own
        // zoom, and it is the one whose point is the middle of the view.
        pinch: kind === "wheel" ? mouse.ctrlKey === true : mouse.metaKey !== true,
        area: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      });
    };

    const onWheel = (event: WheelEvent) => {
      if (gestureActive.current) {
        event.preventDefault();
        return;
      }
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const intensity = event.deltaMode === 1 ? 0.05 : 0.0018;
      const factor = Math.exp(-event.deltaY * intensity);
      const { x, y } = pointFor(event, "wheel");
      applyZoom(zoomRef.current * factor, x, y);
    };

    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureActive.current = true;
      gestureStartZoom.current = zoomRef.current;
    };

    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const { scale } = event as WebKitGestureEvent;
      const { x, y } = pointFor(event, "gesture");
      applyZoom(gestureStartZoom.current * scale, x, y);
    };

    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureActive.current = false;
    };

    const preventGesture = (event: Event) => event.preventDefault();

    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false });
    stage.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false });
    stage.addEventListener("gestureend", onGestureEnd as EventListener, { passive: false });
    document.addEventListener("gesturestart", preventGesture, { passive: false });
    document.addEventListener("gesturechange", preventGesture, { passive: false });

    return () => {
      observer.disconnect();
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("gesturestart", onGestureStart as EventListener);
      stage.removeEventListener("gesturechange", onGestureChange as EventListener);
      stage.removeEventListener("gestureend", onGestureEnd as EventListener);
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
    };
  }, [applyZoom, cursorRef, stageRef, zoomRef]);

  return { size };
}
