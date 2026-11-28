/**
 * Moving a list while one of its rows is being dragged.
 *
 * The drag preview is portalled to `document.body` for a reason (a transformed
 * ancestor would become its containing block), and it sits under the pointer for
 * the whole drag. So a wheel — a mouse's, or two fingers on a trackpad — lands on
 * the preview, which has no scrollable ancestor, and the list underneath does not
 * move. The list therefore takes the gesture itself while a drag is in flight and
 * adds it to its own `scrollTop`.
 *
 * Only the wheel has to be handed over. dnd-kit follows a scroller it did not move:
 * a row's rect is read through its own scrollable ancestors, so after a scroll the
 * rows that moved under the pointer are the rows a drop lands on, and the preview
 * stays on the pointer.
 *
 * The edge auto-scroll is the other half of the same problem, and it is the part
 * that needs nothing here: `DndContext` scrolls the list by itself when the pointer
 * is held near its top or bottom. A board that turns that off (`autoScroll={false}`,
 * as the Documents rail does, because its insert line is measured in its own frame
 * loop) drives both halves itself, with the constants and the step below.
 */

/** How close the pointer must be to the top or bottom of the list before it scrolls. */
export const DRAG_SCROLL_EDGE_PX = 64;

/** The fastest the list moves, in pixels per frame, when the pointer is at the edge. */
export const DRAG_SCROLL_MAX_PX = 14;

/** A wheel's `deltaMode` values (`WheelEvent.DOM_DELTA_PIXEL` / `_LINE` / `_PAGE`). */
const DELTA_LINE = 1;
const DELTA_PAGE = 2;

/** One line of a line-mode wheel, in pixels. */
const LINE_PX = 16;

/**
 * The pixels one wheel step asks for.
 *
 * A trackpad reports pixels; a mouse wheel usually reports lines; a page-mode
 * wheel (an accessibility setting) reports whole viewports. The list is scrolled in
 * pixels, so all three are brought to the same unit first.
 */
export function wheelPixels(
  step: { deltaY: number; deltaMode: number },
  viewportHeight: number,
): number {
  if (step.deltaMode === DELTA_LINE) return step.deltaY * LINE_PX;
  if (step.deltaMode === DELTA_PAGE) return step.deltaY * viewportHeight;
  return step.deltaY;
}

/**
 * How far the list moves in one frame, from how far into the edge the pointer is.
 *
 * Slow as the pointer reaches the band, up to `DRAG_SCROLL_MAX_PX` at the edge
 * itself — so a nudge over the last row does not throw the list past the row the
 * reader was aiming for. Never zero: once the pointer is in the band, the list has
 * to move or the gesture reads as broken.
 */
export function edgeScrollStep(intoEdge: number): number {
  const ratio = Math.min(1, intoEdge / DRAG_SCROLL_EDGE_PX);
  return Math.max(1, Math.round(ratio * DRAG_SCROLL_MAX_PX));
}

/**
 * The box a list scrolls in: the nearest ancestor that actually scrolls, the node
 * passed in included (a list that is its own scroller, as the Documents rail's is,
 * answers itself).
 *
 * "Actually scrolls" is checked, not just declared: an `overflow: auto` box with
 * nothing past its edge would take the wheel and move nothing, which would strand
 * the gesture at the outer box that does scroll.
 */
export function dragScroller(node: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = node;
  while (current) {
    const overflowY = getComputedStyle(current).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay")
      && current.scrollHeight > current.clientHeight + 1
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * One wheel step, applied to `scroller` unless the gesture landed in it.
 *
 * Returns whether the scroller moved, so the caller can `preventDefault` the wheel
 * — otherwise the same gesture would be taken by whatever is behind the panel. A
 * wheel that lands on the scroller is left alone: it already moves it, and a
 * second subtraction here would double the speed of the list.
 */
export function scrollByWheel(event: WheelEvent, scroller: HTMLElement): boolean {
  // `Ctrl` / `⌘` + wheel is a pinch, not a scroll: it belongs to the zoom.
  if (event.ctrlKey || event.metaKey) return false;
  const target = event.target;
  if (target instanceof Node && scroller.contains(target)) return false;
  const dy = wheelPixels(event, scroller.clientHeight);
  if (dy === 0) return false;
  scroller.scrollTop += dy;
  return true;
}
