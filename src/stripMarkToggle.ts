/**
 * "Highlight this passage": the yellow strokes a reading strip's text becomes,
 * and the toggle that takes them away again.
 *
 * A highlight is a horizontal stroke on a page, in PDF points, the same list the
 * pen lays by dragging (see `stripHighlight.ts`). The difference here is where
 * the strokes come from: the reader framed a band — the reading strip, or the
 * paragraph under a right-click — and asked for the whole passage at once, so
 * the strokes are derived from the page's own text instead of from a drag.
 *
 * One stroke per line, not one rectangle over the band: a band covers several
 * lines and the gaps between them, and a single rectangle would paint the
 * leading as well as the words. The lines come from the text boxes the reader
 * is looking at, so a two-column page highlights each column's own run of text
 * rather than one bar across the gutter.
 *
 * The toggle is decided by geometry, not by an id: a stroke has none. Asking
 * "is this band already highlighted" means asking whether every line it covers
 * has a stroke over it, and pressing again removes those strokes. A partly
 * highlighted passage is completed rather than inverted, which is what makes a
 * first press on a half-marked paragraph do what it looks like it should.
 */
import type { TextBox } from "./paragraph";
import type { DocumentHighlight, StripHighlight } from "./stripHighlight";

/** Where a band sits on its page, in PDF points. */
export type BandMarkArea = {
  top: number;
  height: number;
  left: number;
  width: number;
};

/**
 * How much of a line a stroke has to cover before it counts as marked.
 *
 * Below this it is a stroke across a few words, not a highlighted line, and the
 * toggle adds the line instead of deciding it is already done. Chosen loosely
 * enough that a saved stroke, which is rounded to hundredths when it is stored,
 * still matches the line it was laid on.
 */
const COVER_RATIO = 0.6;

/** Smallest gap between two runs that starts a new horizontal segment, in points. */
const SEGMENT_GAP_MIN_PT = 18;

type Row = { top: number; bottom: number; boxes: TextBox[] };

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** The band's box, normalised, for the math below. */
function boxOf(mark: StripHighlight): { left: number; right: number; top: number; bottom: number; width: number; size: number } {
  const left = Math.min(mark.x0, mark.x1);
  const right = Math.max(mark.x0, mark.x1);
  return { left, right, top: mark.y, bottom: mark.y + mark.size, width: right - left, size: mark.size };
}

/**
 * The strokes that mark the text inside `band`.
 *
 * `column` narrows the boxes to one column of a multi-column page: a paragraph
 * found by a right-click lives in one column, and its band spans the whole page,
 * so without it the neighbouring column's lines would be highlighted too. The
 * reading strip passes none, because what it frames really is the whole width of
 * the page.
 *
 * A band with no text under it (a scan, a figure, the gap between paragraphs)
 * still deserves a visible answer: the whole band becomes one stroke.
 */
export function bandMarkCandidates(
  boxes: readonly TextBox[],
  band: BandMarkArea,
  options: { column?: { left: number; right: number } } = {},
): StripHighlight[] {
  if (!(band.width > 0) || !(band.height > 0)) return [];
  const fallback: StripHighlight[] = [
    { x0: band.left, x1: band.left + band.width, y: band.top, size: band.height },
  ];

  const inside = boxes.filter((box) => {
    if (!(box.width > 0) || !(box.height > 0)) return false;
    // A run belongs to the band when its centre line does. A tall glyph that
    // pokes out of the band still belongs to the line it sits on.
    const centre = box.top + box.height / 2;
    if (centre < band.top || centre > band.top + band.height) return false;
    const column = options.column;
    if (!column) return true;
    const overlap = Math.min(box.left + box.width, column.right) - Math.max(box.left, column.left);
    return overlap > 0;
  });
  if (inside.length === 0) return fallback;

  const rows = clusterRows(inside);
  const gapBreak = Math.max(SEGMENT_GAP_MIN_PT, median(inside.map((box) => box.height)) * 1.8);
  const marks: StripHighlight[] = [];
  for (const row of rows) {
    for (const segment of splitRow(row.boxes, gapBreak)) {
      const left = Math.min(...segment.map((box) => box.left));
      const right = Math.max(...segment.map((box) => box.left + box.width));
      if (right - left < 0.5) continue;
      marks.push({ x0: left, x1: right, y: row.top, size: row.bottom - row.top });
    }
  }
  return marks.length > 0 ? marks : fallback;
}

/** Group runs into the lines they are read on. */
function clusterRows(boxes: readonly TextBox[]): Row[] {
  const sorted = [...boxes].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows: Row[] = [];
  for (const box of sorted) {
    const top = box.top;
    const bottom = box.top + box.height;
    const row = rows.find((candidate) => {
      const overlap = Math.min(candidate.bottom, bottom) - Math.max(candidate.top, top);
      const minHeight = Math.min(candidate.bottom - candidate.top, box.height);
      return minHeight > 0 && overlap > minHeight * 0.4;
    });
    if (!row) {
      rows.push({ top, bottom, boxes: [box] });
      continue;
    }
    row.top = Math.min(row.top, top);
    row.bottom = Math.max(row.bottom, bottom);
    row.boxes.push(box);
  }
  rows.sort((a, b) => a.top - b.top);
  return rows;
}

/** Cut one line into the runs of text separated by a wide gap (a gutter, a cell). */
function splitRow(boxes: readonly TextBox[], gapBreak: number): TextBox[][] {
  const sorted = [...boxes].sort((a, b) => a.left - b.left);
  const segments: TextBox[][] = [];
  let current: TextBox[] = [];
  let right = Number.NEGATIVE_INFINITY;
  for (const box of sorted) {
    if (current.length > 0 && box.left - right > gapBreak) {
      segments.push(current);
      current = [];
      right = Number.NEGATIVE_INFINITY;
    }
    current.push(box);
    right = Math.max(right, box.left + box.width);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/** Whether one stroke covers a line of text: enough of its width and height. */
export function markCovers(candidate: StripHighlight, mark: StripHighlight): boolean {
  const line = boxOf(candidate);
  const stroke = boxOf(mark);
  const vertical = Math.min(line.bottom, stroke.bottom) - Math.max(line.top, stroke.top);
  const horizontal = Math.min(line.right, stroke.right) - Math.max(line.left, stroke.left);
  if (vertical < line.size * COVER_RATIO) return false;
  if (horizontal < line.width * COVER_RATIO) return false;
  return true;
}

/** Whether every line of a band already has a stroke over it. */
export function bandMarked(
  marks: readonly DocumentHighlight[],
  page: number,
  candidates: readonly StripHighlight[],
): boolean {
  if (candidates.length === 0) return false;
  const onPage = marks.filter((mark) => mark.page === page);
  return candidates.every((candidate) => onPage.some((mark) => markCovers(candidate, mark)));
}

export type BandMarkToggle = {
  /** The document's whole mark list, ready to store. */
  marks: DocumentHighlight[];
  /** What the press did; `none` when there was nothing to toggle. */
  action: "added" | "removed" | "none";
  added: number;
  removed: number;
};

/**
 * Add the band's strokes, or take away the ones already there.
 *
 * Nothing is inverted per line: a press either completes the band or clears it.
 * Clearing removes every mark on the page that touches one of the lines — a
 * single wide stroke drawn over the whole band goes with the first press.
 */
export function toggleBandMarks(
  marks: readonly DocumentHighlight[],
  page: number,
  candidates: readonly StripHighlight[],
): BandMarkToggle {
  const none: BandMarkToggle = { marks: [...marks], action: "none", added: 0, removed: 0 };
  if (candidates.length === 0) return none;

  const onPage = marks.filter((mark) => mark.page === page);
  const covered = (candidate: StripHighlight) =>
    onPage.some((mark) => markCovers(candidate, mark));

  if (candidates.every(covered)) {
    const next = marks.filter(
      (mark) => mark.page !== page || !candidates.some((candidate) => markCovers(candidate, mark)),
    );
    const removed = marks.length - next.length;
    if (removed === 0) return none;
    return { marks: next, action: "removed", added: 0, removed };
  }

  const missing = candidates.filter((candidate) => !covered(candidate));
  if (missing.length === 0) return none;
  return {
    marks: [...marks, ...missing.map((candidate) => ({ page, ...candidate }))],
    action: "added",
    added: missing.length,
    removed: 0,
  };
}
