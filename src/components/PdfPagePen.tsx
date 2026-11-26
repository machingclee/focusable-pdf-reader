/**
 * The pen on one PDF page.
 *
 * Highlight mode is a property of the open document, so this catch is drawn on
 * every page while the toolbar pen is down. A drag is horizontal, in PDF
 * points, and the release hands the stroke back to be saved on the document.
 */
import { useEffect, useRef, type PointerEvent } from "react";
import { currentBrush, horizontalMark, subscribeBrush, type PagePoint } from "../stripHighlight";
import { pointerSpot } from "../pointerSpot";

type PageGeom = { left: number; top: number; cssPerPoint: number };

const STUB_PX = 10;

export function PdfPagePen({
  pageWidth,
  pageHeight,
  onStroke,
}: {
  pageWidth: number;
  pageHeight: number;
  /** A finished horizontal stroke, in PDF points on this page. */
  onStroke: (mark: { x0: number; x1: number; y: number; size: number }) => void;
}) {
  const anchorRef = useRef<PagePoint | null>(null);
  const geomRef = useRef<PageGeom | null>(null);
  const stubRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLSpanElement | null>(null);
  /** Where the pointer last was, in viewport px. A zoom places the stub again from here. */
  const lastPointRef = useRef<{ clientX: number; clientY: number } | null>(null);

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
    const height = pageHeight > 0 ? pageHeight : 1;
    const width = pageWidth > 0 ? pageWidth : 1;
    return {
      x: Math.min(width, Math.max(0, (clientX - geom.left) / geom.cssPerPoint)),
      y: Math.min(height, Math.max(0, (clientY - geom.top) / geom.cssPerPoint)),
    };
  };

  /**
   * Put the brush under the pointer.
   *
   * The height is the brush in PDF points at the page's current scale, so the
   * cursor says how thick the mark will be at whatever zoom the page is read
   * at. The pointer's last place is kept: a zoom resizes the page box, and the
   * stub has to be laid out again at the new scale even though the pointer has
   * not moved. `is-stroke` marks the drag: the stub is the cursor while idle,
   * and the stroke being drawn once the press starts.
   *
   * The pointer is the *middle* of the block, not its top-left corner: a brush
   * is taller than the arrow beside it, and a block that grew downwards from the
   * pointer read as the cursor sliding down the page when the pen was armed.
   * Centring it means the thickness grows both ways and the pointer stays where
   * the reader left it. The stroke follows the same rule (`strokeTop`), so the
   * press does not move the band either.
   */
  const placeStub = (clientX: number, clientY: number) => {
    const node = stubRef.current;
    lastPointRef.current = { clientX, clientY };
    const geom = geomRef.current ?? measure();
    if (!node || !geom) return;
    const anchor = anchorRef.current;
    const height = Math.max(currentBrush() * geom.cssPerPoint, 1);
    let x = clientX;
    let y = clientY - height / 2;
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

  /**
   * The top edge of a stroke pressed at `pointerY`, in PDF points.
   *
   * The press is the middle of the band, the same place the idle cursor put the
   * pointer, so the mark lands where the cursor stood and covers the line under
   * it instead of starting on it. Kept on the paper: a press against the top or
   * bottom of the page slides the band back inside rather than laying half of it
   * off the sheet.
   */
  const strokeTop = (pointerY: number, size: number): number => {
    const height = pageHeight > 0 ? pageHeight : 1;
    return Math.min(Math.max(pointerY - size / 2, 0), Math.max(height - size, 0));
  };

  const hideStub = () => {
    lastPointRef.current = null;
    const node = stubRef.current;
    if (node) node.hidden = true;
  };

  /**
   * A zoom changes the page box, and with it how many pixels one PDF point
   * covers. That measurement is what the brush height and the press are read
   * from, so it is thrown away here — otherwise the cursor keeps the thickness
   * it was measured at and a zoomed page gets a brush of the old scale.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      geomRef.current = null;
      const last = lastPointRef.current;
      if (!last) return;
      placeStub(last.clientX, last.clientY);
    });
    observer.observe(host);
    return () => observer.disconnect();
    // The stub is written from this event path, never from a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * `[` and `]` change the brush with no pointer event to hang the redraw on.
   *
   * The stub is only ever written from the pointer path, so without this the
   * cursor keeps the thickness it was last drawn at — the size in the toolbar
   * changes, but the thing under the pointer does not, until it is moved. The
   * brush module says when the size moved, and the stub is laid out again at
   * the pointer's last place, which has not moved at all.
   */
  useEffect(
    () =>
      subscribeBrush(() => {
        const last = lastPointRef.current;
        if (last) placeStub(last.clientX, last.clientY);
      }),
    // The stub is written from this subscription, never from a render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * The cursor is already under the pointer when the pen goes down.
   *
   * `H` and the page's right-click menu arm the pen at the pointer, and the
   * reader has not moved since — but nothing here is written from a render, so
   * without this the stub waited for the next pointer event. The cursor then
   * appeared only after the pointer was moved, and at the place it had been
   * moved to rather than the place the pen was armed at, which reads as the
   * cursor jumping as it arrives.
   *
   * The pointer's last place is the whole input, so the stub is laid out from
   * that alone. Every page mounts this pen while the pen is down, so only the
   * page the point is actually on draws it: a point over the toolbar, the
   * notes column or another page is nothing for this pen to show.
   */
  useEffect(() => {
    const spot = pointerSpot();
    if (!spot) return;
    const geom = geomRef.current ?? measure();
    if (!geom) return;
    const width = pageWidth > 0 ? pageWidth : 1;
    const height = pageHeight > 0 ? pageHeight : 1;
    const right = geom.left + width * geom.cssPerPoint;
    const bottom = geom.top + height * geom.cssPerPoint;
    if (spot.x < geom.left || spot.x > right || spot.y < geom.top || spot.y > bottom) return;
    placeStub(spot.x, spot.y);
    // Armed once, from the render that mounted the pen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    measure();
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const size = currentBrush();
    anchorRef.current = { x: point.x, y: strokeTop(point.y, size) };
    placeStub(event.clientX, event.clientY);
  };

  const onUp = (event: PointerEvent<HTMLSpanElement>) => {
    const start = anchorRef.current;
    anchorRef.current = null;
    hideStub();
    if (!start) return;
    const end = pointAt(event.clientX, event.clientY);
    if (!end) return;
    const mark = horizontalMark(start, end.x, currentBrush());
    if (mark) onStroke(mark);
  };

  return (
    <>
      <span
        ref={hostRef}
        className="pdf-highlight-catch"
        onPointerDown={onDown}
        onPointerMove={(event) => placeStub(event.clientX, event.clientY)}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => {
          if (anchorRef.current) return;
          hideStub();
        }}
      />
      <div ref={stubRef} className="focus-highlight-stub" hidden />
    </>
  );
}
