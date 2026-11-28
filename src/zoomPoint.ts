/**
 * The screen point a zoom keeps still.
 *
 * A zoom is a change of scale about one point, and every way the reader can ask
 * for one carries a point that has to be read carefully, because the wrong one
 * lands the page somewhere the reader was not looking:
 *
 * - **A wheel's point is the pointer's.** The platform fills it in from where the
 *   cursor actually is, so it is exact and it cannot be stale, and it is the first
 *   thing to trust.
 * - **`⌘` + wheel does not arrive as a wheel at all: this webview turns it into a
 *   zoom *gesture*, and a gesture reports the centre of the gesture — the middle of
 *   the view — not the pointer.** Reading that is what made the document scale
 *   about the page's middle while the passage under the cursor ran out from under
 *   it. A non-pinch gesture therefore asks the pointer instead, and falls back to
 *   its own centre only when the pointer has never been over the page area.
 * - **A pinch is the one gesture whose own point is right**: there it is the
 *   fingers', which is what the reader is squeezing, while a parked pointer may be
 *   on the other side of the window.
 * - **A point may be missing altogether.** Some platforms report none, and the ones
 *   that have nothing to report send zeros — as a point that is the screen's
 *   top-left corner, which the page area never reaches, so it can only be that
 *   placeholder. An anchor there drags the view to the document's first page.
 *
 * The order is kept here, apart from the stage hook, so the rule can be read and
 * tested on its own.
 */

export type ZoomPoint = {
  /** Viewport pixels from the left edge. */
  x: number;
  /** Viewport pixels from the top edge. */
  y: number;
};

export type ZoomArea = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Which of the viewer's two zoom gestures asked for the point. */
export type ZoomGestureKind = "wheel" | "gesture";

export type ZoomPointInput = {
  kind: ZoomGestureKind;
  /** The point the event reports, if it reports a usable one. */
  eventPoint: ZoomPoint | null;
  /** The pointer's last known place on the window, if it has been seen. */
  pointer: ZoomPoint | null;
  /** Whether this is a trackpad pinch, whose own point is the fingers'. */
  pinch: boolean;
  /** The page area, in viewport pixels. */
  area: ZoomArea;
};

/**
 * A point an event reported, or `null` when it reported nothing usable.
 *
 * `undefined` is a webview with no position to give; `(0, 0)` is the placeholder
 * the ones that have a position to give-but-not-really use. Both are "no point".
 */
export function reportedPoint(
  x: number | null | undefined,
  y: number | null | undefined,
): ZoomPoint | null {
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x === 0 && y === 0) return null;
  return { x, y };
}

/** Whether a point is inside the page area, edges included. */
export function isInsideArea(area: ZoomArea, point: ZoomPoint): boolean {
  return (
    point.x >= area.left &&
    point.x <= area.left + area.width &&
    point.y >= area.top &&
    point.y <= area.top + area.height
  );
}

/** The point a zoom around this gesture must hold still. */
export function zoomPointFor({
  kind,
  eventPoint,
  pointer,
  pinch,
  area,
}: ZoomPointInput): ZoomPoint {
  // A pinch's own point is the fingers', which is what the reader is squeezing —
  // a parked pointer would anchor a pinch on wherever the mouse was left.
  if (pinch && eventPoint) return eventPoint;
  // A wheel's own point is the pointer's, exact and current.
  if (kind === "wheel" && eventPoint) return eventPoint;
  // Everything else is anchored on the pointer: it is the reader's own place, and
  // it is the one point a `⌘` + wheel's gesture coordinates do not report.
  if (pointer && isInsideArea(area, pointer)) return pointer;
  if (eventPoint) return eventPoint;
  return { x: area.left + area.width / 2, y: area.top + area.height / 2 };
}
