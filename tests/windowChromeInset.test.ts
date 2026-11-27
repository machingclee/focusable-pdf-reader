import { describe, expect, test } from "bun:test";
import { windowChromeEnd } from "../src/useWindowChromeInset";

describe("windowChromeEnd", () => {
  test("the veil starts under both drag rows", () => {
    // The title strip is 34px and the toolbar hangs under it. The handle is
    // the pair, so the veil's top is the toolbar's bottom, not the strip's.
    expect(
      windowChromeEnd([
        { height: 34, bottom: 34 },
        { height: 38, bottom: 72 },
      ]),
    ).toBe(72);
  });

  test("a hidden row does not pull the edge back up", () => {
    // The PDF toolbar stays mounted while the Dashboard is showing, with no
    // box. Counting it would report 0 and the veil would cover the strip again.
    expect(
      windowChromeEnd([
        { height: 34, bottom: 34 },
        { height: 0, bottom: 0 },
        { height: 40, bottom: 74 },
      ]),
    ).toBe(74);
  });

  test("a notes window, which has only the title strip, clears that strip", () => {
    expect(windowChromeEnd([{ height: 34, bottom: 34 }])).toBe(34);
  });

  test("a fractional edge is rounded up so the last pixel of the handle stays clear", () => {
    expect(windowChromeEnd([{ height: 72.2, bottom: 72.2 }])).toBe(73);
  });

  test("no chrome yet leaves the veil where it was", () => {
    expect(windowChromeEnd([])).toBe(0);
  });
});
