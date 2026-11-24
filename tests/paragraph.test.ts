import { describe, expect, test } from "bun:test";
import { findParagraphAt, findParagraphRegionAt, type TextBox } from "../src/paragraph";

/**
 * Two paragraphs in one column: three wrapped lines, a paragraph gap, then two
 * more. 10pt lines on a 13pt pitch, the way a body-text page reads.
 */
const boxes: TextBox[] = [
  { left: 72, top: 100, width: 380, height: 10 },
  { left: 72, top: 113, width: 380, height: 10 },
  { left: 72, top: 126, width: 200, height: 10 },
  { left: 72, top: 168, width: 380, height: 10 },
  { left: 72, top: 181, width: 200, height: 10 },
];

/** A click in the middle of the first paragraph. */
const X = 200;
const Y = 113;

const limits = { minHeight: 10, maxHeight: 640 };

function centre(box: { top: number; height: number }): number {
  return box.top + box.height / 2;
}

describe("findParagraphAt", () => {
  test("the hole covers the wrapped lines and nothing past the break", () => {
    // 100 → 136 is the paragraph; a 2pt pad on each edge is the whole margin.
    expect(findParagraphAt(boxes, X, Y, limits)).toEqual({ top: 98, height: 40 });
  });

  test("no slack is the tight box, so callers that want none still get it", () => {
    expect(findParagraphAt(boxes, X, Y, limits)).toEqual(findParagraphAt(boxes, X, Y, { ...limits, slack: 0 }));
  });

  test("slack opens the box up and down by the same amount", () => {
    const tight = findParagraphAt(boxes, X, Y, limits);
    const loose = findParagraphAt(boxes, X, Y, { ...limits, slack: 9 });
    expect(tight).not.toBeNull();
    expect(loose).not.toBeNull();
    if (!tight || !loose) return;

    expect(loose.height).toBe(tight.height + 9);
    // Equal halves: the paragraph keeps the same place in the middle rather than
    // being pushed down by the whole amount.
    expect(loose.top).toBe(tight.top - 4.5);
    expect(centre(loose)).toBe(centre(tight));
    // The default band in points: 98..138 tight, 93.5..142.5 with three quarters
    // of a `]` step.
    expect(loose).toEqual({ top: 93.5, height: 49 });
  });

  test("the default opens the box by three quarters of a `]` step", () => {
    // `DOUBLE_CLICK_SLACK` is 0.75 steps: a hair past the tight box, well short of
    // one press. Every box stays centred on the paragraph it frames.
    const step = 12;
    const at = (slack: number) => findParagraphAt(boxes, X, Y, { ...limits, slack });
    const tight = at(0);
    const one = at(step);
    const preferred = at(step * 0.75);
    expect(tight && one && preferred).toBeTruthy();
    if (!tight || !one || !preferred) return;

    expect(preferred.height).toBe(tight.height + 9);
    expect(preferred.height).toBeGreaterThan(tight.height);
    expect(preferred.height).toBeLessThan(one.height);
    expect(centre(preferred)).toBe(centre(one));
  });

  test("slack bends at the strip's limits, and the limits still hold", () => {
    const capped = findParagraphAt(boxes, X, Y, { ...limits, maxHeight: 30, slack: 9 });
    expect(capped?.height).toBe(30);
    // The click stays inside the band it asked for.
    expect(capped!.top).toBeLessThanOrEqual(Y);
    expect(capped!.top + capped!.height).toBeGreaterThanOrEqual(Y);

    const floor = findParagraphAt(boxes, X, Y, { ...limits, minHeight: 100, slack: 9 });
    expect(floor?.height).toBe(100);
    expect(centre(floor!)).toBe(centre({ top: 98, height: 40 }));
  });

  test("a click in the gap finds the nearer paragraph, not both", () => {
    // y=150 is between the paragraphs: 14pt from the first, 18pt from the second.
    const found = findParagraphAt(boxes, X, 150, limits);
    expect(found).toEqual({ top: 98, height: 40 });
  });

  test("a click far from any text chooses nothing", () => {
    expect(findParagraphAt(boxes, X, 900, limits)).toBeNull();
    expect(findParagraphAt([], X, Y, limits)).toBeNull();
  });
});

describe("findParagraphRegionAt", () => {
  test("the same band as findParagraphAt, plus the column it was read in", () => {
    const region = findParagraphRegionAt(boxes, X, Y, limits);
    expect(region).toEqual({ top: 98, height: 40, left: 72, right: 452 });
    expect(findParagraphAt(boxes, X, Y, limits)).toEqual({
      top: region!.top,
      height: region!.height,
    });
  });

  test("a two-column page stays in the column the click was in", () => {
    // Two 220pt columns with a 38pt gutter. The band is the same shape; the
    // column edges are what keep a highlight off the neighbouring column.
    const columns: TextBox[] = [
      { left: 72, top: 100, width: 220, height: 10 },
      { left: 330, top: 100, width: 220, height: 10 },
      { left: 72, top: 113, width: 220, height: 10 },
      { left: 330, top: 113, width: 220, height: 10 },
    ];
    const left = findParagraphRegionAt(columns, 180, 113, limits);
    expect(left).toEqual({ top: 98, height: 27, left: 72, right: 292 });

    const right = findParagraphRegionAt(columns, 440, 113, limits);
    expect(right).toEqual({ top: 98, height: 27, left: 330, right: 550 });
  });

  test("nothing under the click is no region", () => {
    expect(findParagraphRegionAt([], X, Y, limits)).toBeNull();
  });
});
