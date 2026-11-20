import { describe, expect, test } from "bun:test";
import { PREVIEW_MAX_SCALE, previewWidthCapPx } from "../src/stripPreview";

const band = { page_number: 3, top: 100, height: 80, page_width: 595 };

describe("previewWidthCapPx", () => {
  test("the widest a band is drawn is a multiple of its page's width", () => {
    // A strip is a slice of paper: it may be enlarged to be readable in a wide
    // column, but not to the point of turning body text into headlines.
    expect(previewWidthCapPx(band)).toBeCloseTo(595 * PREVIEW_MAX_SCALE, 6);
    expect(previewWidthCapPx({ ...band, page_width: 612 })).toBeCloseTo(612 * PREVIEW_MAX_SCALE, 6);
  });

  test("a normal column is filled, a very wide one is not blown up", () => {
    // A laptop's Notes column is about two pages across (a 595 pt page in a
    // ~1200 px column), so the ceiling has to clear that or the strip can never
    // use the column it sits in. Past it the band stops growing rather than
    // turning body text into headlines.
    expect(PREVIEW_MAX_SCALE).toBeGreaterThanOrEqual(2);
    expect(PREVIEW_MAX_SCALE).toBeLessThanOrEqual(4);
  });

  test("a page width the row cannot vouch for means no cap at all", () => {
    // A hand-edited or old row: better to draw the band as wide as the card than
    // to shrink a real strip to nothing on a guess.
    for (const page_width of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(previewWidthCapPx({ ...band, page_width })).toBeNull();
    }
  });
});
