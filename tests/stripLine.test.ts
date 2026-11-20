import { describe, expect, test } from "bun:test";
import { placeStripPoint, STRIP_LINE_FRACTION } from "../src/stripLine";

const base = {
  stageHeight: 1000,
  lineFraction: STRIP_LINE_FRACTION,
  pageHeight: 1200,
  maxScrollTop: 5000,
};

describe("placeStripPoint", () => {
  test("the line is a fifth of the way down the stage", () => {
    // The band sits high so most of the page stays below it; a tenth would crowd
    // the toolbar and a half (where it started) left the reading half on show.
    expect(STRIP_LINE_FRACTION).toBe(0.2);
    expect(placeStripPoint({ ...base, pageTop: 0, fracY: 0.5, scrollTop: 0 }).centerY).toBeCloseTo(200, 6);
  });

  test("scrolls the point onto the line", () => {
    // 900 down the stage; the line is at 200, so 700 comes off the offset.
    const placement = placeStripPoint({ ...base, pageTop: 300, fracY: 0.5, scrollTop: 0 });
    expect(placement.scrollTop).toBe(700);
    expect(placement.centerY).toBeCloseTo(200, 6);
  });

  test("lands any page fraction on the same line", () => {
    for (const fracY of [0.1, 0.5, 0.9]) {
      const placement = placeStripPoint({ ...base, pageTop: 600, fracY, scrollTop: 0 });
      expect(placement.centerY).toBeCloseTo(base.stageHeight * base.lineFraction, 6);
    }
  });

  test("rides the page at the top of the document", () => {
    // 120 down the stage, and scrolling up is what the line would need.
    const placement = placeStripPoint({ ...base, pageTop: 0, fracY: 0.1, scrollTop: 0 });
    expect(placement.scrollTop).toBe(0);
    expect(placement.centerY).toBe(120);
  });

  test("stops at the end of the document", () => {
    const placement = placeStripPoint({ ...base, pageTop: 20, fracY: 0.5, scrollTop: 4800 });
    expect(placement.scrollTop).toBe(5000);
    expect(placement.centerY).toBe(420);
  });

  test("a strip's start lands on the line, half a band below it", () => {
    // The point being placed is the band's centre; half a 300px band lower is
    // where its start sits on the line. Without the offset a tall strip put its
    // start above the top of the viewport and the passage was read from its
    // middle.
    const placement = placeStripPoint({
      ...base,
      pageTop: 0,
      fracY: 0.5,
      scrollTop: 0,
      pointOffsetPx: 150,
    });
    expect(placement.centerY).toBeCloseTo(base.stageHeight * base.lineFraction + 150, 6);
    // Which is: one more scroll step of 150px than centring it would have taken.
    expect(placement.scrollTop).toBe(600 - (200 + 150));
  });

  test("the offset does not break either end of the document", () => {
    // At the top of the document the scroll still clamps at 0, and the band rides
    // the page instead of pretending to reach the line.
    const start = placeStripPoint({ ...base, pageTop: 0, fracY: 0.02, scrollTop: 0, pointOffsetPx: 150 });
    expect(start.scrollTop).toBe(0);
    const end = placeStripPoint({ ...base, pageTop: 20, fracY: 0.5, scrollTop: 4800, pointOffsetPx: 150 });
    expect(end.scrollTop).toBe(5000);
  });

  test("does not move a document that cannot scroll", () => {
    const placement = placeStripPoint({ ...base, pageTop: 700, fracY: 0.5, scrollTop: 0, maxScrollTop: 0 });
    expect(placement.scrollTop).toBe(0);
    expect(placement.centerY).toBe(1300);
  });
});
