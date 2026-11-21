/**
 * The arithmetic behind the divider that sits under the note's strip preview.
 *
 * The dialog is a fixed-height column: header, the strip band, the panes, the
 * footer. The band is `flex: 0 0 auto` and the panes are `flex: 1 1 auto`, so the
 * band's height is exactly what decides how much dialog is left for the editor
 * and the preview — one drag on the divider trades one for the other, with the
 * footer and header untouched.
 *
 * Kept apart from the dialog, like `stripBand.ts` and `notesScroll.ts`, so the
 * clamping rules can be tested without a browser, a canvas or Monaco.
 */

/**
 * Shortest the band may be dragged to.
 *
 * Not zero: the strip is the thing the note is about, and the divider itself has
 * to stay grabbable. About three lines of page text, or the band of a two-line
 * strip with its page margin.
 */
export const MIN_BAND_HEIGHT = 56;

/**
 * Shortest the panes may become while the band is dragged taller.
 *
 * A drag should not be able to leave the editor as a two-line slit: Monaco and
 * the preview both need a few lines before editing in either is possible, and
 * the vertical splitter between them needs a silhouette.
 */
export const MIN_PANE_HEIGHT = 200;

/** The range of band heights, in CSS px, that one drag may move between. */
export type BandBounds = { min: number; max: number };

export type BandResizeInput = {
  /** Height the band is at now (its starting point for the drag), in px. */
  height: number;
  /** Height the panes are at now, in px. */
  bodyHeight: number;
  /** Height the whole strip asks for at the current width, in px. */
  contentHeight: number;
};

/**
 * The height the strip has when drawn `shownWidth` wide.
 *
 * Taken from the paint's own pixels rather than from the laid-out box: the band
 * stretches the canvas to its own height, so the box says how tall the band is,
 * not how tall the strip is. The canvas' width/height pair is the strip's aspect
 * ratio — in device pixels, which cancels — so one division recovers the rest.
 *
 * `0` when the canvas has no paint yet, which `bandResizeBounds` reads as "no
 * ceiling known".
 */
export function stripHeightAt(
  shownWidth: number,
  canvasWidth: number,
  canvasHeight: number,
): number {
  if (!(shownWidth > 0) || !(canvasWidth > 0) || !(canvasHeight > 0)) return 0;
  return (shownWidth * canvasHeight) / canvasWidth;
}

/**
 * The range a drag may move the band into.
 *
 * The ceiling is the strip's own height: the band is drawn full-width with its
 * aspect ratio, so past that the drag would only add empty paper-free space —
 * a preview is either the strip or a window onto it, never padded. It is also
 * held to whatever leaves the panes their minimum, which is the rule that keeps
 * the dialog usable in a short window.
 *
 * The floor wins if the two conflict (a window too short for `MIN_PANE_HEIGHT`
 * plus `MIN_BAND_HEIGHT`): a stuck divider that still leaves a sliver of every
 * pane is better than an inverted range that pins the band to the top.
 */
export function bandResizeBounds({ height, bodyHeight, contentHeight }: BandResizeInput): BandBounds {
  const min = MIN_BAND_HEIGHT;
  // `height + bodyHeight` is the column's leftover space, which does not change
  // while the band is dragged: what the band gains, the panes lose.
  const roomForPanes = height + bodyHeight - MIN_PANE_HEIGHT;
  // A strip that has not painted yet reports no height; capping at "no ceiling"
  // then is right, because the pane minimum still applies.
  const natural = contentHeight > 0 ? contentHeight : Number.POSITIVE_INFINITY;
  return { min, max: Math.max(min, Math.min(natural, roomForPanes)) };
}

/** Clamp a proposed band height (from a drag or a keypress) into `bounds`. */
export function clampBandHeight(height: number, bounds: BandBounds): number {
  // `NaN` has no side to fall on, and `height: NaNpx` is not a style the browser
  // honours — the band would silently stay where it was. The floor is the honest
  // answer. The infinities are ordinary clamps and fall through.
  if (Number.isNaN(height)) return bounds.min;
  // Whole pixels: the divider is drawn at a device-pixel boundary anyway, and
  // this keeps a long drag from accumulating subpixel crumbs.
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, height)));
}
