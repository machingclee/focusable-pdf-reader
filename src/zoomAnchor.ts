/**
 * The screen point a *layout* change keeps still.
 *
 * Opening or closing the notes column changes the page area's width, and the page
 * is rescaled to keep the share of the window it had (`zoomForArea`). Every point
 * of the document then moves except one, and matching that point's screen position
 * is how the reader keeps their place across the toggle.
 *
 * The point is not the pointer. A column toggle is a chord or a toolbar button,
 * and the pointer is wherever it was left — over the column the press is about to
 * hide, or over a card clicked a minute ago — which says nothing about what is
 * being read. Worse, it is inside the page area while the column is closed and
 * outside it while the column is open, so the point it names changes with the
 * toggle itself: the page would be anchored somewhere different on the way in than
 * on the way out, and a reader toggling back and forth would walk the page down a
 * step at a time. A layout change is about the reading position, so that is what
 * this returns.
 *
 * Kept apart from `App` so the rule can be read and tested on its own.
 */

export type AnchorArea = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * How far below the page area's top edge the reading line sits.
 *
 * The page's top edge is the line a page is read from, and a hair below it is in
 * the page rather than in the scroller's top padding, which is what the scroller
 * measures from. Only a hair, so nothing readable is pushed out of the area by
 * the toggle.
 */
export const READ_LINE_INSET = 24;

/**
 * The point to scale around, in client coordinates.
 *
 * `bandY` is the centre of the reading strip — the passage the reader is on — or
 * `null` when no strip is showing. A band that has been scrolled out of the page
 * area is not anchored on: it names a page that may not even be on screen, and the
 * correction would then land the page somewhere nobody was reading.
 */
export function zoomAnchorInArea(area: AnchorArea, bandY: number | null): { x: number; y: number } {
  const x = area.left + area.width / 2;
  const readLine = area.top + READ_LINE_INSET;
  if (bandY === null || !Number.isFinite(bandY)) return { x, y: readLine };
  if (bandY < area.top || bandY > area.top + area.height) return { x, y: readLine };
  return { x, y: bandY };
}
