import { describe, expect, test } from "bun:test";
import { zoomForArea } from "../src/zoomProportion";

describe("zoomForArea", () => {
  test("a page area that loses a fifth hands the page a fifth less zoom", () => {
    // The notes column takes 300px of a 1500px page area: the page has to keep the
    // share of the window it had, so it shrinks by the same ratio.
    expect(zoomForArea(1, 1500, 1200)).toBeCloseTo(0.8, 10);
    expect(zoomForArea(1.5, 1500, 1200)).toBeCloseTo(1.2, 10);
    // And back again, which is what closing the column does.
    expect(zoomForArea(0.8, 1200, 1500)).toBeCloseTo(1, 10);
  });

  test("halving and doubling are the inverse of each other", () => {
    const half = zoomForArea(1.25, 1600, 800);
    expect(half).toBeCloseTo(0.625, 10);
    expect(zoomForArea(half, 800, 1600)).toBeCloseTo(1.25, 10);
  });

  test("an area that did not change leaves the zoom alone", () => {
    expect(zoomForArea(1.1, 1200, 1200)).toBe(1.1);
  });

  test("an unmeasured or unusable width is not treated as a ratio", () => {
    // The viewer is hidden on the Notes tab, so its width reads as zero; a ratio
    // built from that would scale the document down to nothing.
    for (const [previous, next] of [
      [0, 1200],
      [1200, 0],
      [-100, 1200],
      [1200, -100],
      [Number.NaN, 1200],
      [1200, Number.NaN],
      [Number.POSITIVE_INFINITY, 1200],
    ]) {
      expect(zoomForArea(1, previous, next)).toBe(1);
    }
  });

  test("a zoom that is not a number comes back untouched", () => {
    expect(zoomForArea(Number.NaN, 1200, 900)).toBeNaN();
    expect(zoomForArea(0, 1200, 900)).toBe(0);
  });
});
