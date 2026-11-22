import { describe, expect, test } from "bun:test";
import { placePagePreview } from "../src/placePagePreview";

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
