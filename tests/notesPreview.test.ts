import { describe, expect, test } from "bun:test";
import { stripBandLayout } from "../src/stripBand";

describe("stripBandLayout", () => {
  test("scales the page so the band is exactly the target width", () => {
    // A4-ish page: 595 pt wide, a 60 pt tall strip at y=120.
    const layout = stripBandLayout(595, { top: 120, height: 60 }, 595);
    expect(layout.scale).toBe(1);
    expect(layout.width).toBe(595);
    expect(layout.height).toBe(60);
    expect(layout.translateY).toBe(-120);
  });

  test("keeps the band's aspect ratio when the width is scaled up", () => {
    const layout = stripBandLayout(595, { top: 200, height: 42 }, 1190);
    expect(layout.scale).toBe(2);
    expect(layout.width).toBe(1190);
    expect(layout.height).toBe(84);
    expect(layout.translateY).toBe(-400);
  });

  test("survives a strip parked past the page edge", () => {
    // The geometry is clamped when saved, but a hand-edited row could still be
    // odd: the maths must not produce a zero-sized canvas or NaN.
    const layout = stripBandLayout(595, { top: 900, height: 30 }, 300);
    expect(layout.width).toBe(300);
    expect(layout.height).toBe(15);
    expect(Number.isFinite(layout.translateY)).toBe(true);
    expect(layout.translateY).toBeLessThan(0);
  });

  test("never divides by a zero page width", () => {
    const layout = stripBandLayout(0, { top: 0, height: 10 }, 240);
    expect(Number.isFinite(layout.scale)).toBe(true);
    expect(Number.isFinite(layout.translateY)).toBe(true);
    expect(layout.height).toBeGreaterThan(0);
  });
});
