import { describe, expect, test } from "bun:test";
import { READ_LINE_INSET, zoomAnchorInArea } from "../src/zoomAnchor";

const area = { left: 100, top: 60, width: 900, height: 800 };
const readLine = area.top + READ_LINE_INSET;

describe("zoomAnchorInArea", () => {
  test("the band is what a layout change keeps still", () => {
    // In focus mode the band is the passage being read, so the page scales around
    // it: the strip stays on the same line and the text in it does not move.
    expect(zoomAnchorInArea(area, 300)).toEqual({ x: area.left + area.width / 2, y: 300 });
  });

  test("the anchor is the middle of the page area, whichever line holds still", () => {
    // The page is centred in the area, so the horizontal middle is the page's own
    // middle — the one column line that is the same point before and after a
    // rescale, even though the area's width changes.
    expect(zoomAnchorInArea(area, 300).x).toBe(550);
    expect(zoomAnchorInArea(area, null).x).toBe(550);
  });

  test("with no band, the line a page is read from holds still", () => {
    expect(zoomAnchorInArea(area, null)).toEqual({ x: 550, y: readLine });
    expect(READ_LINE_INSET).toBeGreaterThan(0);
  });

  test("a band scrolled out of the area is not the anchor", () => {
    // Off screen above or below, the strip says nothing about what is on screen,
    // and a point outside the area names a page that may not be there.
    expect(zoomAnchorInArea(area, area.top - 1).y).toBe(readLine);
    expect(zoomAnchorInArea(area, area.top + area.height + 1).y).toBe(readLine);
    // The edges themselves are still on screen.
    expect(zoomAnchorInArea(area, area.top).y).toBe(area.top);
    expect(zoomAnchorInArea(area, area.top + area.height).y).toBe(area.top + area.height);
  });

  test("a band in the area is used exactly as measured", () => {
    // No rounding or nudging: the same passage has to land on the same line,
    // otherwise every toggle would shift it by the difference.
    const y = 417.5;
    expect(zoomAnchorInArea(area, y).y).toBe(y);
  });

  test("an unmeasured band position is not an anchor", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(zoomAnchorInArea(area, bad).y).toBe(readLine);
    }
  });

  test("the same band line is chosen no matter what the column is doing", () => {
    // The whole bug in one assertion: only the band (or the read line) may decide
    // the anchor, so opening and closing pick the same point and the page returns
    // to where it started instead of creeping down.
    const open = { left: 100, top: 60, width: 900, height: 800 };
    const closed = { left: 100, top: 60, width: 1300, height: 800 };
    const bandY = 380;
    expect(zoomAnchorInArea(open, bandY).y).toBe(zoomAnchorInArea(closed, bandY).y);
    expect(zoomAnchorInArea(open, null).y).toBe(zoomAnchorInArea(closed, null).y);
  });
});
