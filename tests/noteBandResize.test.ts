import { describe, expect, test } from "bun:test";
import {
  MIN_BAND_HEIGHT,
  MIN_PANE_HEIGHT,
  bandResizeBounds,
  clampBandHeight,
} from "../src/noteBandResize";

/** A 780 px dialog: band already at its 38vh-ish cap, panes filling the rest. */
const short = { height: 300, bodyHeight: 380, contentHeight: 900 };

describe("bandResizeBounds", () => {
  test("the band cannot be dragged away altogether", () => {
    // The strip is what the note is about and the divider has to stay grabbable,
    // so the floor is a visible band, not zero.
    expect(bandResizeBounds(short).min).toBe(MIN_BAND_HEIGHT);
    expect(MIN_BAND_HEIGHT).toBeGreaterThanOrEqual(40);
    expect(MIN_BAND_HEIGHT).toBeLessThan(short.height);
  });

  test("the drag stops at the strip: no paper-free padding under it", () => {
    // The strip already fills the band, so dragging down would only add blank
    // space — not a bigger preview.
    expect(bandResizeBounds({ height: 300, bodyHeight: 380, contentHeight: 300 }).max).toBe(300);
  });

  test("a clipped strip can be dragged open, up to its whole height", () => {
    // The default band is capped at a share of the viewport and clips the rest;
    // the divider is the way to see all of it, provided the panes can spare it
    // (here they can: 300 + 900 - 200 leaves 1000, past the strip's 900).
    expect(
      bandResizeBounds({ height: 300, bodyHeight: 900, contentHeight: 900 }).max,
    ).toBe(900);
  });

  test("the panes keep their minimum even when the strip is tall", () => {
    // height + bodyHeight is the dialog's leftover space; the band may take all
    // of it except MIN_PANE_HEIGHT.
    const bounds = bandResizeBounds({ height: 300, bodyHeight: 380, contentHeight: 2000 });
    expect(bounds.max).toBe(300 + 380 - MIN_PANE_HEIGHT);
  });

  test("a strip that has not painted yet does not pin the band to its floor", () => {
    // scrollHeight is 0 until a canvas is in place; capping at 0 would make the
    // divider jump to MIN_BAND_HEIGHT on a drag that should have worked.
    const bounds = bandResizeBounds({ height: 300, bodyHeight: 380, contentHeight: 0 });
    expect(bounds.max).toBe(300 + 380 - MIN_PANE_HEIGHT);
    expect(bounds.max).toBeGreaterThan(bounds.min);
  });

  test("a window too short for both minimums yields a stuck but valid range", () => {
    // An inverted range would pin the band to the top on every drag; the floor
    // winning keeps the dialog readable and the divider where the user left it.
    const bounds = bandResizeBounds({ height: 60, bodyHeight: 90, contentHeight: 400 });
    expect(bounds).toEqual({ min: MIN_BAND_HEIGHT, max: MIN_BAND_HEIGHT });
    expect(clampBandHeight(200, bounds)).toBe(MIN_BAND_HEIGHT);
  });
});

describe("clampBandHeight", () => {
  const bounds = { min: 56, max: 400 };

  test("heights inside the range pass through, rounded to whole pixels", () => {
    expect(clampBandHeight(200, bounds)).toBe(200);
    expect(clampBandHeight(200.4, bounds)).toBe(200);
    expect(clampBandHeight(200.6, bounds)).toBe(201);
  });

  test("the ends are held", () => {
    expect(clampBandHeight(0, bounds)).toBe(56);
    expect(clampBandHeight(-900, bounds)).toBe(56);
    expect(clampBandHeight(401, bounds)).toBe(400);
    expect(clampBandHeight(Number.POSITIVE_INFINITY, bounds)).toBe(400);
  });

  test("a non-finite height falls back to the floor instead of NaN in a style", () => {
    // `height: NaNpx` is not a style the browser honours, and the band would
    // silently stay at whatever it was.
    expect(clampBandHeight(Number.NaN, bounds)).toBe(56);
    expect(clampBandHeight(Number.NEGATIVE_INFINITY, bounds)).toBe(56);
  });
});
