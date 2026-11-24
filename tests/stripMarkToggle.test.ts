import { describe, expect, test } from "bun:test";
import type { TextBox } from "../src/paragraph";
import type { DocumentHighlight } from "../src/stripHighlight";
import {
  bandMarkCandidates,
  bandMarked,
  markCovers,
  toggleBandMarks,
} from "../src/stripMarkToggle";

/**
 * A body-text page: 380pt-wide lines at x=72, 10pt tall, on a 13pt pitch.
 * `BAND` frames the first two lines with the usual padding, and `left`/`width`
 * are the column edges a saved strip would have recorded.
 */
const LINES: TextBox[] = [
  { left: 72, top: 100, width: 380, height: 10 },
  { left: 72, top: 113, width: 380, height: 10 },
  { left: 72, top: 126, width: 380, height: 10 },
];
const BAND = { top: 98, height: 30, left: 72, width: 380 };

function mark(page: number, marks: { x0: number; x1: number; y: number; size: number }[]): DocumentHighlight[] {
  return marks.map((item) => ({ page, ...item }));
}

describe("bandMarkCandidates", () => {
  test("one stroke per line, spanning the text on it", () => {
    expect(bandMarkCandidates(LINES, BAND)).toEqual([
      { x0: 72, x1: 452, y: 100, size: 10 },
      { x0: 72, x1: 452, y: 113, size: 10 },
    ]);
  });

  test("runs whose centre is outside the band are not marked", () => {
    // 124..134 holds the third line's centre (131) and neither of the others.
    const marks = bandMarkCandidates(LINES, { ...BAND, top: 124, height: 10 });
    expect(marks).toEqual([{ x0: 72, x1: 452, y: 126, size: 10 }]);
  });

  test("a wide gap splits one line into its own runs of text", () => {
    const table: TextBox[] = [
      { left: 72, top: 100, width: 70, height: 10 },
      { left: 220, top: 100, width: 232, height: 10 },
    ];
    expect(bandMarkCandidates(table, { ...BAND, left: 72, width: 380 })).toEqual([
      { x0: 72, x1: 142, y: 100, size: 10 },
      { x0: 220, x1: 452, y: 100, size: 10 },
    ]);
  });

  test("a column drops the neighbouring column's lines", () => {
    const twoColumns: TextBox[] = [
      { left: 72, top: 100, width: 220, height: 10 },
      { left: 330, top: 100, width: 220, height: 10 },
      { left: 72, top: 113, width: 220, height: 10 },
      { left: 330, top: 113, width: 220, height: 10 },
    ];
    expect(
      bandMarkCandidates(twoColumns, BAND, { column: { left: 72, right: 292 } }),
    ).toEqual([
      { x0: 72, x1: 292, y: 100, size: 10 },
      { x0: 72, x1: 292, y: 113, size: 10 },
    ]);
  });

  test("a band with no text under it is highlighted as one block", () => {
    expect(bandMarkCandidates([], BAND)).toEqual([
      { x0: 72, x1: 452, y: 98, size: 30 },
    ]);
  });

  test("a band with no area marks nothing", () => {
    expect(bandMarkCandidates(LINES, { ...BAND, width: 0 })).toEqual([]);
    expect(bandMarkCandidates(LINES, { ...BAND, height: 0 })).toEqual([]);
  });
});

describe("markCovers", () => {
  const line = { x0: 72, x1: 452, y: 100, size: 10 };

  test("a stroke laid on the line covers it", () => {
    expect(markCovers(line, { x0: 72, x1: 452, y: 100, size: 10 })).toBe(true);
    // A brush taller than the line still covers it.
    expect(markCovers(line, { x0: 60, x1: 460, y: 97, size: 16 })).toBe(true);
  });

  test("a stroke across a few words is not a highlighted line", () => {
    expect(markCovers(line, { x0: 72, x1: 200, y: 100, size: 10 })).toBe(false);
  });

  test("a stroke on the line above does not count", () => {
    expect(markCovers(line, { x0: 72, x1: 452, y: 86, size: 10 })).toBe(false);
  });
});

describe("toggleBandMarks", () => {
  const candidates = bandMarkCandidates(LINES, BAND);

  test("an unmarked band is marked", () => {
    const outcome = toggleBandMarks([], 3, candidates);
    expect(outcome.action).toBe("added");
    expect(outcome.added).toBe(2);
    expect(outcome.marks).toEqual(mark(3, candidates));
  });

  test("a marked band is cleared, and only the band's own strokes go", () => {
    const existing: DocumentHighlight[] = [
      ...mark(3, candidates),
      // Same page, a different passage: it stays.
      { page: 3, x0: 72, x1: 452, y: 300, size: 10 },
      // Another page: it stays.
      { page: 4, x0: 72, x1: 452, y: 100, size: 10 },
    ];
    const outcome = toggleBandMarks(existing, 3, candidates);
    expect(outcome.action).toBe("removed");
    expect(outcome.removed).toBe(2);
    expect(outcome.marks).toEqual([
      { page: 3, x0: 72, x1: 452, y: 300, size: 10 },
      { page: 4, x0: 72, x1: 452, y: 100, size: 10 },
    ]);
  });

  test("a partly marked band is completed, not cleared", () => {
    const existing = mark(3, [candidates[0]!]);
    const outcome = toggleBandMarks(existing, 3, candidates);
    expect(outcome.action).toBe("added");
    expect(outcome.added).toBe(1);
    expect(outcome.marks).toEqual(mark(3, candidates));
  });

  test("one wide stroke over the whole band goes with the first press", () => {
    const existing: DocumentHighlight[] = [{ page: 3, x0: 72, x1: 452, y: 98, size: 30 }];
    const outcome = toggleBandMarks(existing, 3, candidates);
    expect(outcome.action).toBe("removed");
    expect(outcome.removed).toBe(1);
    expect(outcome.marks).toEqual([]);
  });

  test("a band with nothing under it still toggles its block", () => {
    const block = bandMarkCandidates([], BAND);
    const added = toggleBandMarks([], 1, block);
    expect(added.marks).toEqual([{ page: 1, ...block[0]! }]);
    expect(toggleBandMarks(added.marks, 1, block).marks).toEqual([]);
  });

  test("no candidates changes nothing", () => {
    const outcome = toggleBandMarks(mark(1, candidates), 1, []);
    expect(outcome.action).toBe("none");
    expect(outcome.marks).toEqual(mark(1, candidates));
  });
});

describe("bandMarked", () => {
  const candidates = bandMarkCandidates(LINES, BAND);

  test("true only when every line of the band has a stroke", () => {
    expect(bandMarked(mark(2, candidates), 2, candidates)).toBe(true);
    expect(bandMarked(mark(2, [candidates[0]!]), 2, candidates)).toBe(false);
    expect(bandMarked(mark(3, candidates), 2, candidates)).toBe(false);
    expect(bandMarked([], 2, [])).toBe(false);
  });
});
