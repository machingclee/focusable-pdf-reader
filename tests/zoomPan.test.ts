import { describe, expect, test } from "bun:test";
import { NO_PAN, panAndScroll, type PanCorrection } from "../src/zoomPan";

const at = (over: Partial<PanCorrection> = {}): PanCorrection => ({
  error: { x: 0, y: 0 },
  scroll: { x: 0, y: 0 },
  limit: { x: 1000, y: 1000 },
  pan: NO_PAN,
  ...over,
});

describe("panAndScroll", () => {
  test("with room to scroll, the scroller does all of it", () => {
    const result = panAndScroll(at({ scroll: { x: 200, y: 300 }, error: { x: -50, y: 40 } }));
    expect(result.scroll).toEqual({ x: 150, y: 340 });
    expect(result.pan).toEqual(NO_PAN);
  });

  test("a sheet that cannot scroll is carried by the page column", () => {
    // A page narrower than the page area has no horizontal range at all: the offset
    // is pinned at zero, so the word can only be held by the column moving itself.
    // The error is negative — the page point sits left of the pointer — so the page
    // has to come right, which is a positive displacement.
    const result = panAndScroll(at({ limit: { x: 0, y: 400 }, error: { x: -200, y: 30 } }));
    expect(result.scroll).toEqual({ x: 0, y: 30 });
    expect(result.pan).toEqual({ x: 200, y: 0 });
  });

  test("the top of the document is carried the same way", () => {
    // At the first page there is nothing above it to scroll to, so a zoom-out that
    // has to move the pages down leaves the scroller at zero and the column with
    // the displacement.
    const result = panAndScroll(at({ scroll: { x: 0, y: 0 }, error: { x: 0, y: -120 } }));
    expect(result.scroll).toEqual({ x: 0, y: 0 });
    expect(result.pan).toEqual({ x: 0, y: 120 });
  });

  test("the scroller takes what it can and the column the rest", () => {
    // 40 pixels of range left, 150 needed: the scroller gives its last 40 and the
    // other 110 become the column's offset.
    const result = panAndScroll(
      at({ scroll: { x: 960, y: 0 }, error: { x: 150, y: 0 }, pan: { x: 0, y: 0 } }),
    );
    expect(result.scroll).toEqual({ x: 1000, y: 0 });
    expect(result.pan).toEqual({ x: -110, y: 0 });
  });

  test("a second correction adds to the offset already carried", () => {
    // Two notches of a wheel are two corrections against the pages the first one
    // left, so the displacement accumulates rather than starting over.
    const first = panAndScroll(at({ limit: { x: 0, y: 1000 }, error: { x: -80, y: 0 } }));
    expect(first.pan).toEqual({ x: 80, y: 0 });
    const second = panAndScroll(
      at({ limit: { x: 0, y: 1000 }, error: { x: -50, y: 0 }, pan: first.pan }),
    );
    expect(second.pan).toEqual({ x: 130, y: 0 });
  });

  test("an offset already carried can be handed back to the scroller", () => {
    // Zooming in again opens a range. The error then measures the pages as the
    // column's offset left them, so the scroller's own move covers part of it and
    // the offset shrinks — it does not have to be cleared by hand.
    const held = { x: 100, y: 0 };
    const result = panAndScroll(
      at({ limit: { x: 600, y: 1000 }, error: { x: -260, y: 0 }, pan: held }),
    );
    // The error is computed against pages already displaced by 100, so 200 of it is
    // the scroller's: it cannot go negative, so only 0 is applied and the rest is
    // carried.
    expect(result.scroll).toEqual({ x: 0, y: 0 });
    expect(result.pan).toEqual({ x: 360, y: 0 });
  });

  test("a limit below zero is no range, never a negative offset", () => {
    const result = panAndScroll(
      at({ limit: { x: -40, y: -10 }, error: { x: 20, y: 20 } }),
    );
    expect(result.scroll).toEqual({ x: 0, y: 0 });
    expect(result.pan).toEqual({ x: -20, y: -20 });
  });

  test("no error changes nothing", () => {
    const pan = { x: 12, y: -8 };
    const result = panAndScroll(at({ scroll: { x: 300, y: 40 }, pan }));
    expect(result.scroll).toEqual({ x: 300, y: 40 });
    expect(result.pan).toEqual(pan);
  });
});
