import { describe, expect, test } from "bun:test";
import {
  ANNOTATION_INK,
  ANNOTATION_LINE_PT,
  ANNOTATION_MAX_LINES,
  ANNOTATION_PIN_PT,
  ANNOTATION_WIDTH_DEFAULT_PT,
  ANNOTATION_WIDTH_MIN_PT,
  annotationAtPoint,
  annotationMark,
  annotationMarks,
  annotationPageBoxes,
  annotationPointFrac,
  clampAnnotationPoint,
  parseStripAnnotations,
  wrapAnnotationText,
} from "../src/annotation";

const band = { top: 100, height: 80, page_width: 200 };

describe("parseStripAnnotations", () => {
  test("reads pins and drops a row that is not one", () => {
    const raw = JSON.stringify([
      { id: 3, x: 10, y: 120, width: 240, text: "a note" },
      { id: 4, x: 10, y: 130 },
      null,
      { id: 5, x: "10", y: 130, text: "text is not a number" },
    ]);
    expect(parseStripAnnotations(raw)).toEqual([
      { id: 3, x: 10, y: 120, width: 240, text: "a note" },
    ]);
  });

  test("a row stored before the content had a width is drawn at the default", () => {
    const raw = JSON.stringify([{ id: 7, x: 1, y: 2, text: "old" }]);
    expect(parseStripAnnotations(raw)).toEqual([
      { id: 7, x: 1, y: 2, width: ANNOTATION_WIDTH_DEFAULT_PT, text: "old" },
    ]);
  });

  test("an empty or broken column is no pins", () => {
    expect(parseStripAnnotations("[]")).toEqual([]);
    expect(parseStripAnnotations("")).toEqual([]);
    expect(parseStripAnnotations(undefined)).toEqual([]);
    expect(parseStripAnnotations("{")).toEqual([]);
    expect(parseStripAnnotations('{"id":1}')).toEqual([]);
  });
});

describe("annotationPointFrac", () => {
  test("is the pin's own place on the page", () => {
    expect(annotationPointFrac({ id: 1, x: 0, y: 200, width: 150, text: "" }, 800)).toBe(0.25);
  });

  test("stays inside the page for a nonsense height or point", () => {
    expect(annotationPointFrac({ id: 1, x: 0, y: 200, width: 150, text: "" }, 0)).toBe(1);
    expect(annotationPointFrac({ id: 1, x: 0, y: -5, width: 150, text: "" }, 800)).toBe(0);
    expect(annotationPointFrac({ id: 1, x: 0, y: 900, width: 150, text: "" }, 800)).toBe(1);
    expect(annotationPointFrac({ id: 1, x: 0, y: Number.NaN, width: 150, text: "" }, 800)).toBe(0);
  });
});

describe("clampAnnotationPoint", () => {
  test("keeps the whole pin on the paper", () => {
    expect(clampAnnotationPoint(3000, 900, 595, 842)).toEqual({
      x: 595 - ANNOTATION_PIN_PT,
      y: 842 - ANNOTATION_PIN_PT,
    });
    expect(clampAnnotationPoint(-10, -10, 595, 842)).toEqual({ x: 0, y: 0 });
    expect(clampAnnotationPoint(100, 200, 595, 842)).toEqual({ x: 100, y: 200 });
  });

  test("a page smaller than one pin still answers zero", () => {
    expect(clampAnnotationPoint(5, 5, 6, 6)).toEqual({ x: 0, y: 0 });
  });
});

describe("annotationAtPoint", () => {
  const page = { width: 200, height: 400 };
  const pins = [
    { id: 1, x: 10, y: 10, width: 150, text: "first" },
    { id: 2, x: 40, y: 40, width: 150, text: "second" },
  ];

  test("finds the pin under the point", () => {
    expect(annotationAtPoint(pins, { x: 12, y: 12 }, page)).toBe(0);
    expect(annotationAtPoint(pins, { x: 45, y: 45 }, page)).toBe(1);
  });

  test("the writing is not guessed at: it answers for itself in the DOM", () => {
    // A point well inside the old card's box is bare paper to this test now: the
    // content is a live surface with its own right-click and its own height.
    expect(annotationAtPoint(pins, { x: 10 + 18 + 60, y: 12 }, page)).toBeNull();
  });

  test("later pins win where two overlap", () => {
    const overlapping = [
      { id: 1, x: 10, y: 10, width: 150, text: "first" },
      { id: 2, x: 12, y: 12, width: 150, text: "second" },
    ];
    expect(annotationAtPoint(overlapping, { x: 14, y: 14 }, page)).toBe(1);
  });

  test("bare paper and slack", () => {
    expect(annotationAtPoint(pins, { x: 300, y: 300 }, page)).toBeNull();
    // Just past the pin's edge is a miss, unless the caller widens the box.
    expect(annotationAtPoint([pins[0]!], { x: 10 - 4, y: 12 }, page)).toBeNull();
    expect(annotationAtPoint([pins[0]!], { x: 10 - 4, y: 12 }, page, 6)).toBe(0);
  });
});

describe("annotationPageBoxes", () => {
  const page = { width: 200 };

  const pin = (x: number, y: number, width = 150) => ({ id: 1, x, y, width, text: "here" });

  test("puts the content on the pin's right, clear of it, at the row's width", () => {
    const boxes = annotationPageBoxes(pin(10, 20), page);
    expect(boxes.size).toBe(ANNOTATION_PIN_PT);
    expect(boxes.card).toEqual({
      left: ANNOTATION_PIN_PT + 6,
      top: ANNOTATION_PIN_PT / 2 - ANNOTATION_LINE_PT / 2,
      width: 150,
    });
  });

  test("the first line of the content is level with the pin, not its top edge", () => {
    const card = annotationPageBoxes(pin(10, 20), page).card!;
    // Where the first line's middle is, measured from the pin's top.
    expect(card.top + ANNOTATION_LINE_PT / 2).toBeCloseTo(ANNOTATION_PIN_PT / 2, 5);
  });

  test("the width is the reader's, capped by the page's own room", () => {
    // A page with room for it: the row's width is used as it stands.
    expect(annotationPageBoxes(pin(10, 20, 240), { width: 600 }).card?.width).toBe(240);
    // A 200 pt page with the pin at 10 has 172 pt beside it, and that is the cap.
    expect(annotationPageBoxes(pin(10, 20, 240), page).card?.width).toBe(200 - 10 - ANNOTATION_PIN_PT - 6);
    // 200 - 180 - 18 = 2 points left: not enough to draw in.
    expect(annotationPageBoxes(pin(180, 20, 240), page).card).toBeNull();
    const tight = annotationPageBoxes(pin(150, 20, 240), page);
    expect(tight.card?.width).toBe(200 - 150 - ANNOTATION_PIN_PT - 6);
  });

  test("a width below the floor is raised to it", () => {
    const tiny = annotationPageBoxes(pin(10, 20, 5), { width: 400 });
    expect(tiny.card?.width).toBe(ANNOTATION_WIDTH_MIN_PT);
  });

  test("keeps one shape wherever the pin is on the page", () => {
    expect(annotationPageBoxes(pin(10, 380), page).card).toEqual(
      annotationPageBoxes(pin(10, 20), page).card,
    );
  });
});

describe("wrapAnnotationText", () => {
  test("keeps words whole and breaks on the width it was given", () => {
    // The type size is an input, so the wrap is checked at a stated size: 7.5 pt is
    // about 4.1 pt per character, so 40 pt is roughly 9 characters.
    expect(wrapAnnotationText("one two three four", 40, 7.5)).toEqual(["one two", "three", "four"]);
  });

  test("honours the reader's own line breaks", () => {
    expect(wrapAnnotationText("first\nsecond", 400)).toEqual(["first", "second"]);
  });

  test("cuts at the line cap and says there is more", () => {
    const lines = wrapAnnotationText("aaaa ".repeat(40), 40, 7.5, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
  });

  test("an empty text has no lines", () => {
    expect(wrapAnnotationText("   \n\n ", 120)).toEqual([]);
  });

  test("a word wider than the card is cut rather than left to overflow", () => {
    const [line] = wrapAnnotationText("antidisestablishmentarianism", 40);
    expect(line?.endsWith("…")).toBe(true);
  });

  test("the default cap is the one the preview draws", () => {
    expect(wrapAnnotationText("word ".repeat(200), 30)).toHaveLength(ANNOTATION_MAX_LINES);
  });
});

describe("annotationMark", () => {
  const band = { top: 100, height: 80, page_width: 200 };
  const pin = (x: number, y: number, text: string, width = 150) => ({ id: 1, x, y, width, text });

  test("places the pin on the band, with y as its top edge", () => {
    // 100 CSS px across a 200 pt page is half a pixel per point.
    const mark = annotationMark(pin(20, 120, "hello"), band, 100);
    expect(mark?.pin).toEqual({
      left: 10,
      top: 10,
      width: ANNOTATION_PIN_PT / 2,
      height: ANNOTATION_PIN_PT / 2,
    });
  });

  test("a pin above or below the band is not on the crop", () => {
    expect(annotationMark(pin(20, 10, "above"), band, 100)).toBeNull();
    expect(annotationMark(pin(20, 400, "below"), band, 100)).toBeNull();
  });

  test("the markdown is flattened to the words a picture can paint", () => {
    const mark = annotationMark(pin(20, 120, "**bold** and `code`"), band, 200);
    expect(mark?.lines.join(" ")).toBe("bold and code");
    expect(mark?.card.width).toBeGreaterThan(0);
    expect(mark?.card.left).toBeGreaterThan(mark!.pin.left);
  });

  test("a pin against the right edge keeps its head and loses its card", () => {
    const mark = annotationMark(pin(190, 120, "at the edge"), band, 200);
    expect(mark?.pin.width).toBeGreaterThan(0);
    expect(mark?.card.width).toBe(0);
    expect(mark?.lines).toEqual([]);
  });

  test("the card's width is the row's, whatever the crop is drawn at", () => {
    const narrow = annotationMark(pin(10, 120, "wide"), band, 90);
    const wide = annotationMark(pin(10, 120, "wide"), band, 180);
    expect(wide!.card.width).toBeCloseTo(narrow!.card.width * 2, 5);
    expect(wide!.lines).toEqual(narrow!.lines);
  });

  test("every pin in a list keeps its order and its index of the drawn ones", () => {
    const marks = annotationMarks(
      [pin(20, 10, "off the crop"), pin(20, 120, "on it")],
      band,
      100,
    );
    expect(marks.map((mark) => mark.id)).toEqual([1]);
  });
});

describe("ink", () => {
  test("is not the highlight yellow, so the two marks cannot be confused", () => {
    expect(ANNOTATION_INK).not.toBe("#fff44f");
  });

  test("the default content is wide enough to read a few words on a page", () => {
    expect(ANNOTATION_WIDTH_DEFAULT_PT).toBeGreaterThan(ANNOTATION_PIN_PT * 4);
  });
});
