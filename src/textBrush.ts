/**
 * The brush the text under the pointer asks for.
 *
 * Arming the pen with a right-click usually means marking the line the press
 * landed on, so that line's font height is what the brush starts at — a little
 * taller, so the band encloses the glyphs instead of shaving their ascenders
 * and descenders. The line is found by hit-testing the point against the page's
 * text layer; nothing is selected, so the press that arms the pen leaves no
 * selection behind, and the size follows whatever text is under the pointer.
 *
 * A press rarely lands dead centre of a glyph, so a point in the leading above
 * a line, or just before its first character, still counts as that line: the
 * nearest run within a line's reach of the point is the one whose height the
 * brush takes.
 *
 * The brush is stored in PDF points and fonts are read in CSS pixels at the
 * page's current zoom, so the page's own box converts one to the other.
 */

/** How much taller than the hovered text the brush is, in PDF points. */
export const TEXT_BRUSH_MARGIN_PT = 2;

/** How far outside a run's own box a press still counts as being on its line, in CSS pixels. */
export const RUN_SLACK_PX = 8;

/** One text run's box on screen, in CSS pixels. */
export type TextRunBox = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/**
 * The run whose line a point is on, as its index, or null when the point is
 * bare paper.
 *
 * The box has to be under the point horizontally (with a little slack for a
 * press just before the first character), and the nearest one vertically wins.
 * A point further from every box than a line is tall is not on text — otherwise
 * a right-click on a figure or a wide margin would borrow the height of the
 * nearest line, wherever it was.
 */
export function runUnderPoint(
  boxes: readonly TextRunBox[],
  x: number,
  y: number,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    if (!box) continue;
    if (!(box.width > 0) || !(box.height > 0)) continue;
    if (x < box.left - RUN_SLACK_PX || x > box.left + box.width + RUN_SLACK_PX) continue;
    const distance = Math.abs(y - (box.top + box.height / 2));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  if (best === null) return null;
  const box = boxes[best];
  if (!box) return null;
  return bestDistance <= Math.max(RUN_SLACK_PX, box.height) ? best : null;
}

/**
 * A font height in CSS pixels as a brush in PDF points, or null when there is
 * no font to measure.
 *
 * `cssPerPoint` is how many CSS pixels one PDF point covers on the page as it
 * is drawn now: the page's box divided by the page's own width. The answer is
 * rounded to whole points, the step the bracket keys and the sliders use, so
 * the brush readout stays a number the reader could have chosen themselves.
 */
export function brushFromFontPx(fontSizePx: number, cssPerPoint: number): number | null {
  if (!(fontSizePx > 0) || !(cssPerPoint > 0)) return null;
  return Math.round(fontSizePx / cssPerPoint) + TEXT_BRUSH_MARGIN_PT;
}

/** The text run nearest a point on one page, or null on bare paper. */
function nearestTextRun(page: HTMLElement, clientX: number, clientY: number): HTMLElement | null {
  const runs = Array.from(page.querySelectorAll<HTMLElement>(".textLayer span"));
  const boxes = runs.map((run) => {
    const rect = run.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
  const index = runUnderPoint(boxes, clientX, clientY);
  return index === null ? null : runs[index] ?? null;
}

/**
 * The brush the text under a point asks for, in PDF points, or null when there
 * is no page text there.
 *
 * Only the page of the run gives the scale: every page of a document is drawn at
 * the same zoom, and a run cannot span two sheets, so one page's box is enough.
 */
export function brushUnderPoint(clientX: number, clientY: number): number | null {
  if (typeof document === "undefined" || typeof HTMLElement === "undefined") return null;
  // The whole stack, not just the top hit: the reading band's resize edge takes
  // the pointer, and the page under it is still the page being read.
  const page =
    document
      .elementsFromPoint(clientX, clientY)
      .map((element) => element.closest<HTMLElement>(".page-shell"))
      .find((candidate): candidate is HTMLElement => candidate !== null) ?? null;
  if (!page) return null;
  const run = nearestTextRun(page, clientX, clientY);
  if (!run) return null;
  const pageWidth = Number.parseFloat(page.style.getPropertyValue("--page-w"));
  const box = page.getBoundingClientRect();
  if (!(pageWidth > 0) || !(box.width > 0)) return null;
  const fontSize = Number.parseFloat(window.getComputedStyle(run).fontSize);
  return brushFromFontPx(fontSize, box.width / pageWidth);
}
