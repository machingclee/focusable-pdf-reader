import { describe, expect, test } from "bun:test";
import { clampPagePreview, placePagePreview } from "../src/placePagePreview";

describe("placePagePreview", () => {
  test("opens just below and to the right of the pointer", () => {
    expect(placePagePreview(40, 50, 220, 300, 1200, 800)).toEqual({ left: 54, top: 64 });
  });

  test("flips to the other side of the pointer when the page would leave the window", () => {
    expect(placePagePreview(1100, 700, 220, 300, 1200, 800)).toEqual({ left: 866, top: 386 });
  });

  test("clamps a page that is taller than the window", () => {
    const placed = placePagePreview(20, 20, 220, 2000, 800, 600);
    expect(placed.top).toBe(8);
    expect(placed.left).toBe(34);
  });
});

describe("clampPagePreview", () => {
  test("leaves a box that already fits exactly where it is", () => {
    expect(clampPagePreview(300, 200, 440, 620, 1200, 860)).toEqual({ left: 300, top: 200 });
  });

  test("pulls a grown box back inside the window without moving it to the pointer's other side", () => {
    // A page of another shape made the sheet taller after it was placed.
    expect(clampPagePreview(300, 200, 440, 700, 1200, 860)).toEqual({ left: 300, top: 152 });
  });

  test("keeps a box wider than the window at its left edge", () => {
    expect(clampPagePreview(0, 0, 1400, 900, 1200, 800)).toEqual({ left: 8, top: 8 });
  });
});
