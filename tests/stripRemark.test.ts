import { describe, expect, test } from "bun:test";
import {
  REMARK_MARKER_INSET,
  REMARK_MARKER_SIZE,
  remarkMarkerLeft,
  remarkMarkerVertical,
  remarkedStrips,
} from "../src/stripRemark";
import type { Note } from "../src/types/dto";

/** One saved row; by default a strip on page 1 with no note. */
const saved = (over: Partial<Note> = {}): Note => ({
  id: 1,
  pdf_document_id: 1,
  note_folder_id: null,
  ordering: 0,
  page_number: 1,
  top: 100,
  height: 50,
  left: 72,
  width: 300,
  page_width: 595,
  page_height: 842,
  text_excerpt: "Elect a good role model",
  remark: "",
  expanded: true,
  highlights: "[]",
  created_at: 0,
  ...over,
});

describe("remarkedStrips", () => {
  test("only strips with a note get a badge", () => {
    const noted = saved({ id: 1, remark: "**Check** this claim." });
    const blank = saved({ id: 2, remark: "" });
    const spaces = saved({ id: 3, remark: "  \n\t " });
    expect(remarkedStrips([noted, blank, spaces])).toEqual([noted]);
  });

  test("no notes, no badges", () => {
    expect(remarkedStrips([])).toEqual([]);
    expect(remarkedStrips([saved(), saved({ id: 2 })])).toEqual([]);
  });

  test("drawn in page order, then down the page", () => {
    const third = saved({ id: 3, page_number: 2, top: 40, remark: "c" });
    const late = saved({ id: 2, page_number: 1, top: 500, remark: "b" });
    const early = saved({ id: 1, page_number: 1, top: 90, remark: "a" });
    expect(remarkedStrips([third, late, early]).map((strip) => strip.id)).toEqual([1, 2, 3]);
  });

  test("two strips at the same place keep a stable order", () => {
    const second = saved({ id: 9, top: 100, remark: "b" });
    const first = saved({ id: 4, top: 100, remark: "a" });
    expect(remarkedStrips([second, first]).map((strip) => strip.id)).toEqual([4, 9]);
    expect(remarkedStrips([second, first]).map((strip) => strip.id)).toEqual([4, 9]);
  });

  test("the caller's rows are left alone", () => {
    const rows = [saved({ id: 2, page_number: 3, remark: "x" }), saved({ id: 1, remark: "y" })];
    const ordered = remarkedStrips(rows);
    expect(rows.map((strip) => strip.id)).toEqual([2, 1]);
    expect(ordered).not.toBe(rows);
  });
});

describe("remarkMarkerLeft", () => {
  test("sits at the page's left edge, nudged in so the paper shows behind it", () => {
    expect(remarkMarkerLeft(120, 900)).toBe(120 + REMARK_MARKER_INSET);
  });

  test("a page flush with the stage's left edge keeps the badge on screen", () => {
    expect(remarkMarkerLeft(0, 900)).toBe(REMARK_MARKER_INSET);
    // A zoomed page's left edge can sit off the stage entirely.
    expect(remarkMarkerLeft(-200, 900)).toBe(REMARK_MARKER_INSET);
  });

  test("the badge never runs off the right edge of a narrow stage", () => {
    expect(remarkMarkerLeft(5000, 320)).toBe(320 - REMARK_MARKER_SIZE - REMARK_MARKER_INSET);
  });
});

describe("remarkMarkerVertical", () => {
  const stage = 800;

  test("hangs from the passage's top while that edge is on screen", () => {
    expect(remarkMarkerVertical(120, 200, stage)).toEqual({ top: 120, stemHeight: 200 });
  });

  test("keeps the line once the icon has scrolled off the top", () => {
    // The passage runs from -90 to 160. The icon has left with that top edge;
    // the line still covers the passage, and the stage clips what is above it.
    expect(remarkMarkerVertical(-90, 250, stage)).toEqual({ top: -90, stemHeight: 250 });
  });

  test("a passage that ends exactly on the top edge has nothing left to mark", () => {
    expect(remarkMarkerVertical(-200, 200, stage)).toBeNull();
  });

  test("stays hidden until the passage enters from below", () => {
    expect(remarkMarkerVertical(stage, 200, stage)).toBeNull();
    expect(remarkMarkerVertical(stage - 1, 200, stage)).toEqual({ top: stage - 1, stemHeight: 200 });
  });

  test("an icon still crossing the top keeps scrolling off with its passage", () => {
    // Passage ended 5px above the stage; the 24px icon still reaches 9px in.
    expect(remarkMarkerVertical(-15, 10, stage)).toEqual({ top: -15, stemHeight: 10 });
    expect(remarkMarkerVertical(-REMARK_MARKER_SIZE, 0, stage)).toBeNull();
  });

  test("a passage with no depth is just the icon, and only while that edge is on screen", () => {
    expect(remarkMarkerVertical(40, 0, stage)).toEqual({ top: 40, stemHeight: 0 });
    expect(remarkMarkerVertical(-4, 0, stage)).toEqual({ top: -4, stemHeight: 0 });
  });
});
