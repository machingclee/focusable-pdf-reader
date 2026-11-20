/**
 * The maths behind one strip thumbnail, kept apart from the pdf.js plumbing.
 *
 * A saved strip is a page plus a band in PDF points, and this module answers
 * only "how big is the canvas, and how far up does the page have to be shifted
 * so the band lands at y=0". Separate file so it can be tested without dragging
 * a worker, a canvas or Vite's `?url` imports into the test runner.
 */

/** The band's geometry, in canvas pixels. */
export type BandLayout = {
  /** pdf.js scale factor for the page. */
  scale: number;
  /** Canvas size: the full page width, the strip's height. */
  width: number;
  height: number;
  /** Vertical offset that moves the band to the top of the canvas. */
  translateY: number;
};

/**
 * Lay out one band at a target width.
 *
 * `pageWidth` and `band` are in PDF points (scale 1), which is what the saved
 * row stores, so the result is independent of the viewer's current zoom.
 */
export function stripBandLayout(
  pageWidth: number,
  band: { top: number; height: number },
  targetWidthPx: number,
): BandLayout {
  // A hand-edited row could carry a zero page width; the maths must still
  // produce a drawable canvas rather than NaN.
  const safePageWidth = pageWidth > 0 ? pageWidth : 1;
  const width = Math.max(1, Math.round(targetWidthPx));
  const scale = width / safePageWidth;
  const height = Math.max(1, Math.round(band.height * scale));
  return { scale, width, height, translateY: -band.top * scale };
}
