/**
 * The geometry of choosing the display strip with `⌘` + left-drag.
 *
 * The gesture draws a vertical area over the viewer and that area becomes the
 * band: one edge is where the press landed, the other is the pointer, and both
 * are in the stage's own pixels — the same space the overlay's `--hole-top` and
 * `--hole-height` are written in. What the area becomes is not stage px but PDF
 * points, because that is what the strip stores and what keeps it covering the
 * same slice of the page at any zoom.
 *
 * The decisions live here, with no DOM and no React, so they can be read and
 * tested on their own: where the two edges land, what happens when the drag runs
 * past the strip's limits, and how a press that never travelled is told apart
 * from a drag that chose something.
 */

/**
 * A press that never travelled this far chose nothing: `⌘` + click is not a
 * gesture this app has, and a stray few pixels of hand shake at the start of one
 * must not silently resize the reading band to its minimum.
 */
export const MIN_SELECT_PX = 8;

export type StripSelectInput = {
  /** Where the press landed, in stage px. */
  startY: number;
  /** Where the pointer is now, in stage px. */
  currentY: number;
  /** The stage's own height in px: the area cannot leave it. */
  stageHeight: number;
  /** Screen px per PDF point, so the area can be stored in points. */
  zoom: number;
  /** The strip's limits, in PDF points (`MIN_STRIP` / `MAX_STRIP` in `App`). */
  minHeightPt: number;
  maxHeightPt: number;
};

export type StripSelectBand = {
  /** The area's top edge, in stage px — what the marquee draws. */
  top: number;
  /** Its height, in stage px. */
  height: number;
  /** The same height in PDF points, clamped to the strip's limits. */
  heightPt: number;
  /** False when the press did not travel: there is nothing to commit. */
  chosen: boolean;
};

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The area between the press and the pointer, and the strip it would become.
 *
 * Dragging up and dragging down make the same area: the band has no direction,
 * so the two edges are simply ordered. The area is cut at the strip's maximum
 * height — and while it is cut, the edge the press made stays put and the
 * pointer's edge is the one that stops, which is what makes a drag past the limit
 * feel like the band refusing to grow rather than jumping to the pointer.
 */
export function stripSelectBand(input: StripSelectInput): StripSelectBand {
  const zoom = input.zoom > 0 ? input.zoom : 1;
  const stageHeight = Math.max(0, finite(input.stageHeight));
  const startY = clamp(finite(input.startY), 0, stageHeight);
  const currentY = clamp(finite(input.currentY), 0, stageHeight);
  const travel = Math.abs(currentY - startY);

  const maxPx = Math.max(0, finite(input.maxHeightPt) * zoom);
  const height = Math.min(travel, maxPx, stageHeight);
  // Downward: the press is the top edge. Upward: it is the bottom one. Either
  // way the press is the fixed end, and a stage edge can still cut the area.
  const top =
    currentY >= startY
      ? Math.min(startY, stageHeight - height)
      : Math.max(0, startY - height);

  return {
    top,
    height,
    heightPt: clamp(height / zoom, finite(input.minHeightPt), finite(input.maxHeightPt)),
    chosen: travel >= MIN_SELECT_PX,
  };
}
