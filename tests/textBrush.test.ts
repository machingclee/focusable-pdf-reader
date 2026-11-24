import { describe, expect, test } from "bun:test";
import {
  brushFromFontPx,
  runUnderPoint,
  RUN_SLACK_PX,
  TEXT_BRUSH_MARGIN_PT,
  type TextRunBox,
} from "../src/textBrush";

const run = (top: number, left = 10, width = 100, height = 10): TextRunBox => ({
  left,
  top,
  width,
  height,
});

describe("runUnderPoint", () => {
  const page = [run(20), run(34)];

  test("a point on a line is that line", () => {
    expect(runUnderPoint(page, 50, 25)).toBe(0);
    expect(runUnderPoint(page, 50, 39)).toBe(1);
  });

  test("the leading above a line still belongs to it", () => {
    expect(runUnderPoint(page, 50, 18)).toBe(0);
  });

  test("between two lines the nearer one wins", () => {
    expect(runUnderPoint(page, 50, 31)).toBe(0);
    expect(runUnderPoint(page, 50, 33)).toBe(1);
  });

  test("bare paper is no line, even when text is near", () => {
    expect(runUnderPoint(page, 50, 70)).toBeNull();
    expect(runUnderPoint([], 50, 25)).toBeNull();
  });

  test("a press just before the first character is still on the line", () => {
    expect(runUnderPoint(page, 10 - RUN_SLACK_PX, 25)).toBe(0);
    expect(runUnderPoint(page, 10 - RUN_SLACK_PX - 1, 25)).toBeNull();
    expect(runUnderPoint(page, 110 + RUN_SLACK_PX, 25)).toBe(0);
    expect(runUnderPoint(page, 110 + RUN_SLACK_PX + 1, 25)).toBeNull();
  });

  test("a run with no box, like a marked-content wrapper, is not text", () => {
    const boxes = [run(20, 10, 0, 10), run(20, 10, 100, 0), run(20)];
    expect(runUnderPoint(boxes, 50, 25)).toBe(2);
  });
});

describe("brushFromFontPx", () => {
  test("a font height in CSS pixels becomes PDF points", () => {
    // A 600 pt page drawn 300 px wide: one CSS pixel is two points, so a 6 px
    // font is a 12 pt one.
    expect(brushFromFontPx(6, 0.5)).toBe(12 + TEXT_BRUSH_MARGIN_PT);
  });

  test("the brush is slightly taller than the hovered font", () => {
    expect(brushFromFontPx(10, 1)).toBe(10 + TEXT_BRUSH_MARGIN_PT);
    expect(brushFromFontPx(10, 1)).toBeGreaterThan(10);
  });

  test("a bigger font asks for a bigger brush", () => {
    expect(brushFromFontPx(12, 1)).toBeGreaterThan(brushFromFontPx(8, 1)!);
  });

  test("no font, or a page that is not laid out, asks for no size", () => {
    expect(brushFromFontPx(0, 1)).toBeNull();
    expect(brushFromFontPx(Number.NaN, 1)).toBeNull();
    expect(brushFromFontPx(10, 0)).toBeNull();
    expect(brushFromFontPx(10, Number.NaN)).toBeNull();
  });
});
