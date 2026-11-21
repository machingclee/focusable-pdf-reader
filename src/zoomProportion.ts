/**
 * Zoom that keeps the page's share of the page area.
 *
 * The viewer's zoom is absolute — CSS pixels per PDF point — so a page that keeps
 * its zoom while the area around it changes width fills a different share of the
 * window. Sometimes that is what the reader asked for (a wider window is more
 * room around the same page) and sometimes it is not (the notes column opening is
 * not a request for a bigger document, it is a request for the notes). The second
 * case needs this: the page keeps its proportion, so the layout the reader was
 * looking at — line lengths, how much of a page is on screen — survives the
 * column coming and going.
 *
 * Kept apart from `App` so the rule can be read and tested on its own: the zoom it
 * returns still has to be clamped to the viewer's own limits, which is the
 * caller's job.
 */

/**
 * The zoom that gives a page the same share of the page area at `nextWidth` that
 * it had at `previousWidth`.
 *
 * `zoom` comes back unchanged when either width is unusable (before a first
 * measurement, or while the viewer is not on screen to measure at all): a ratio
 * built from a zero would scale the document to nothing.
 */
export function zoomForArea(zoom: number, previousWidth: number, nextWidth: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return zoom;
  if (!(previousWidth > 0) || !(nextWidth > 0)) return zoom;
  if (!Number.isFinite(previousWidth) || !Number.isFinite(nextWidth)) return zoom;
  return zoom * (nextWidth / previousWidth);
}
