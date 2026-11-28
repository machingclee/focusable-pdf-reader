/**
 * The catch that turns a click into a new annotation.
 *
 * With the annotation tool armed, every page mounts this: a transparent layer over
 * the whole sheet that reads a press as a place. It is deliberately not a pen —
 * there is nothing to drag, and a pin is a point. So a release that travelled is
 * not an annotation: that gesture belonged to the reader (a selection started and
 * changed its mind), and turning it into a pin would put a mark somewhere nobody
 * pressed.
 *
 * The measurement is the page's own box, the same way `PdfPagePen` reads it, so a
 * click at 400 % lands on the same word it would at 100 %. The point handed back is
 * in PDF points with `y` from the top of the page — the space a pin is stored in —
 * and it is clamped so the whole pin stays on the paper.
 */
import { useEffect, useRef, type PointerEvent } from "react";
import { clampAnnotationPoint } from "../../annotation";
import type { PagePoint } from "../../stripHighlight";

/** A press that travels further than this is a gesture, not a place. */
const CLICK_SLOP_PX = 4;

type PageGeom = { left: number; top: number; cssPerPoint: number };

export function PdfPageAnnotationCatch({
  pageWidth,
  pageHeight,
  onPoint,
}: {
  pageWidth: number;
  pageHeight: number;
  /**
   * A click on this page: where it landed in PDF points (already kept on the
   * paper), and where it was in the viewport, which is where the editor opens.
   */
  onPoint: (point: PagePoint, clientX: number, clientY: number) => void;
}) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const geomRef = useRef<PageGeom | null>(null);
  /** Where the press started, in viewport px, so a drag can be told from a click. */
  const pressRef = useRef<{ x: number; y: number } | null>(null);

  const measure = (): PageGeom | null => {
    const host = hostRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const geom = { left: rect.left, top: rect.top, cssPerPoint: rect.width / (pageWidth > 0 ? pageWidth : 1) };
    geomRef.current = geom;
    return geom;
  };

  const pointAt = (clientX: number, clientY: number): PagePoint | null => {
    const geom = geomRef.current ?? measure();
    if (!geom) return null;
    return {
      x: (clientX - geom.left) / geom.cssPerPoint,
      y: (clientY - geom.top) / geom.cssPerPoint,
    };
  };

  // A zoom changes the page box, and with it how many pixels one PDF point covers.
  // The measurement is cheap and the press re-measures anyway; dropping it here is
  // what keeps a stale scale from placing the next pin.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      geomRef.current = null;
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const onDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    measure();
    pressRef.current = { x: event.clientX, y: event.clientY };
  };

  const onUp = (event: PointerEvent<HTMLSpanElement>) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press || event.button !== 0) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP_PX) return;
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    onPoint(clampAnnotationPoint(point.x, point.y, pageWidth, pageHeight), event.clientX, event.clientY);
  };

  return (
    <span
      ref={hostRef}
      className="pdf-annotation-catch"
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={() => {
        pressRef.current = null;
      }}
    />
  );
}
