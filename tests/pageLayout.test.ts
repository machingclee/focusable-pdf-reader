import { describe, expect, test } from "bun:test";
import {
  FIT_MARGIN_PX,
  SPREAD_GAP_PX,
  fitZoom,
  pageHoleSpan,
  pairPages,
  sameSpread,
  spreadEnd,
  spreadStart,
} from "../src/pageLayout";

describe("spreadStart", () => {
  test("single page is the page itself", () => {
    expect(spreadStart(4, "single")).toBe(4);
  });

  test("two pages pairs 1–2, 3–4", () => {
    expect(spreadStart(1, "two")).toBe(1);
    expect(spreadStart(2, "two")).toBe(1);
    expect(spreadStart(3, "two")).toBe(3);
    expect(spreadStart(4, "two")).toBe(3);
  });
});

describe("spreadEnd", () => {
  test("names the facing page, and nothing past the last page", () => {
    expect(spreadEnd(1, 5, "two")).toBe(2);
    expect(spreadEnd(2, 5, "two")).toBe(2);
    expect(spreadEnd(5, 5, "two")).toBe(null);
    expect(spreadEnd(4, 5, "single")).toBe(null);
  });
});

describe("sameSpread", () => {
  test("two pages share a spread; the next page does not", () => {
    expect(sameSpread(1, 2, "two")).toBe(true);
    expect(sameSpread(2, 3, "two")).toBe(false);
    expect(sameSpread(1, 2, "single")).toBe(false);
  });
});

describe("pairPages", () => {
  test("groups by two and keeps a trailing page", () => {
    expect(pairPages(["a", "b", "c", "d", "e"])).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(pairPages([])).toEqual([]);
  });
});

describe("fitZoom", () => {
  test("single page fits the first page, as it did before spreads", () => {
    expect(fitZoom(572, [500], "single")).toBe((572 - FIT_MARGIN_PX) / 500);
  });

  test("two pages fit both widths at one scale, with no gap between them", () => {
    expect(fitZoom(1080, [500, 500], "two")).toBe((1080 - FIT_MARGIN_PX - SPREAD_GAP_PX) / 1000);
  });

  test("a one-page document in two-page mode still fits that page", () => {
    expect(fitZoom(572, [500], "two")).toBe((572 - FIT_MARGIN_PX) / 500);
  });
});

describe("pageHoleSpan", () => {
  test("a page inside the stage is the hole", () => {
    expect(pageHoleSpan(1000, 100, 500)).toEqual({ left: 100, width: 400 });
  });

  test("a page hanging off either side is clipped to the stage", () => {
    expect(pageHoleSpan(1000, -40, 300)).toEqual({ left: 0, width: 300 });
    expect(pageHoleSpan(1000, 800, 1200)).toEqual({ left: 800, width: 200 });
  });

  test("a page scrolled fully away leaves no hole", () => {
    expect(pageHoleSpan(1000, -500, -10)).toEqual({ left: 0, width: 0 });
    expect(pageHoleSpan(1000, 1100, 1500)).toEqual({ left: 1000, width: 0 });
  });
});
