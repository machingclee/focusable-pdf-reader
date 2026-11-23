import { describe, expect, test } from "bun:test";
import { readingHoleTakesContextMenu, type HoleRect } from "../src/stripMenuHit";

const hole: HoleRect = { left: 40, top: 200, right: 800, bottom: 360 };

describe("readingHoleTakesContextMenu", () => {
  test("a right-click inside the hole opens the strip menu", () => {
    expect(
      readingHoleTakesContextMenu({
        focusOn: true,
        x: 120,
        y: 280,
        hole,
        ownedByControl: false,
      }),
    ).toBe(true);
  });

  test("the borders count: a right-click on a resize edge is still the hole", () => {
    expect(
      readingHoleTakesContextMenu({
        focusOn: true,
        x: 40,
        y: 200,
        hole,
        ownedByControl: false,
      }),
    ).toBe(true);
  });

  test("a right-click outside the hole does not open it", () => {
    expect(
      readingHoleTakesContextMenu({
        focusOn: true,
        x: 120,
        y: 199,
        hole,
        ownedByControl: false,
      }),
    ).toBe(false);
  });

  test("focus off, and a click a badge or the search field already owns, stay quiet", () => {
    const inside = { focusOn: true, x: 120, y: 280, hole, ownedByControl: false };
    expect(readingHoleTakesContextMenu({ ...inside, focusOn: false })).toBe(false);
    expect(readingHoleTakesContextMenu({ ...inside, hole: null })).toBe(false);
    expect(readingHoleTakesContextMenu({ ...inside, ownedByControl: true })).toBe(false);
  });
});
