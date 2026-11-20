/**
 * Turning the on-screen reading strip into a row in `focusable_strip`.
 *
 * Two different things share the word "strip" in this app:
 *
 * - the display strip: the translucent band the focus overlay draws. Its
 *   position lives in `contentLock` as a page plus a fraction of the page
 *   height, and its height is in PDF points.
 * - the saved strip: one `focusable_strip` row, in page-local PDF points, which
 *   the viewer can later draw again as a display strip.
 *
 * This module owns the conversion in one direction only, from the display strip
 * to a savable record, and keeps it free of DOM and React so it stays testable.
 */
import type { LoadedPage, TextRun } from "./pdf";

export type SavedStripGeometry = {
  /** 1-based page number, same as `data-page` in the viewer. */
  page_number: number;
  /** Page-local position in PDF points, so zoom and window size do not matter. */
  top: number;
  height: number;
  /** Column edges, used later to place the note marker. */
  left: number;
  width: number;
  page_width: number;
  page_height: number;
  /** First ~200 characters: the list label and the backup locator. */
  text_excerpt: string | null;
};

/** Longest excerpt we keep; the column allows more, the list does not want it. */
export const MAX_EXCERPT = 200;

/** PDF points with two decimals, enough precision and no float noise in the DB. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Text runs whose vertical centre falls inside the band. */
function runsInBand(page: LoadedPage, top: number, height: number): TextRun[] {
  const bottom = top + height;
  return page.text.runs.filter((run) => {
    const centre = run.top + run.height / 2;
    return centre >= top && centre <= bottom;
  });
}

/**
 * The band's text as one line: runs in reading order, whitespace collapsed, cut
 * at `limit`. Returns `null` when the band covers no text (a scan, or a strip
 * parked on a gap between paragraphs), which the schema allows.
 */
export function excerptFromRuns(page: LoadedPage, runs: TextRun[], limit = MAX_EXCERPT): string | null {
  if (runs.length === 0) return null;

  const ordered = [...runs].sort((a, b) => a.top - b.top || a.left - b.left);
  const text = ordered
    .map((run) => page.text.fullText.slice(run.start, run.end))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length === 0) return null;
  return text.length > limit ? text.slice(0, limit).trimEnd() : text;
}

/**
 * Geometry for the saved row, from the display strip's centre line.
 *
 * `centreY` and `height` are PDF points in the page's own coordinate space. The
 * band is clamped to the page first, then its column edges come from the runs it
 * covers, so dragging the strip past a margin still records something sane.
 */
export function savedStripGeometry(page: LoadedPage, centreY: number, height: number): SavedStripGeometry {
  const bandHeight = clamp(height, 0, page.height);
  const top = clamp(centreY - bandHeight / 2, 0, Math.max(0, page.height - bandHeight));
  const runs = runsInBand(page, top, bandHeight);

  const widest = runs.reduce(
    (acc, run) => ({ left: Math.min(acc.left, run.left), right: Math.max(acc.right, run.left + run.width) }),
    { left: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY },
  );
  const hasText = runs.length > 0;
  const left = hasText ? widest.left : 0;
  const right = hasText ? widest.right : page.width;

  return {
    page_number: page.index,
    top: round(top),
    height: round(bandHeight),
    left: round(left),
    width: round(Math.max(0, right - left)),
    page_width: round(page.width),
    page_height: round(page.height),
    text_excerpt: excerptFromRuns(page, runs),
  };
}
