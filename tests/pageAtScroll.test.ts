import { describe, expect, test } from "bun:test";
import { pageAtScroll } from "../src/pageAtScroll";

/** Three 565px pages with the preview's 6px gaps between them. */
const PAGE = 565;
const GAP = 6;
const stack = (count: number) => Array.from({ length: count }, (_, index) => index * (PAGE + GAP));
const offsets = (list: number[]) => (index: number) => list[index] ?? 0;

describe("the page a scroll is showing", () => {
  test("an empty stack is page one", () => {
    expect(pageAtScroll(0, offsets([]), { top: 0, height: PAGE, content: 0 })).toBe(1);
  });

  test("the top of the document is its first page", () => {
    expect(pageAtScroll(3, offsets(stack(3)), { top: 0, height: PAGE, content: 3 * (PAGE + GAP) })).toBe(1);
  });

  test("a page is taken up as its top reaches the sheet's top edge", () => {
    const pages = stack(3);
    const at = (top: number) => pageAtScroll(3, offsets(pages), { top, height: PAGE, content: 3 * (PAGE + GAP) });
    // Still page one while its last line is at the top…
    expect(at(PAGE - 1)).toBe(1);
    // …and page two once its first line arrives.
    expect(at(PAGE + GAP)).toBe(2);
  });

  test("a gap between pages belongs to the page above it", () => {
    const pages = stack(3);
    expect(pageAtScroll(3, offsets(pages), { top: PAGE + 2, height: PAGE, content: 3 * (PAGE + GAP) })).toBe(1);
  });

  test("a page taller than the sheet keeps its mark while it is scrolled inside", () => {
    // Page one is 2000px tall: scrolling through it must not mark page two.
    const pages = [0, 2006, 2577];
    const at = (top: number) => pageAtScroll(3, offsets(pages), { top, height: PAGE, content: 3143 });
    expect(at(0)).toBe(1);
    expect(at(1200)).toBe(1);
    expect(at(2006)).toBe(2);
  });

  test("the last page is marked once the bottom of the document is reached", () => {
    // A short last page cannot reach the top edge, so the end of the scroll says it.
    const pages = [0, 571, 1142];
    const content = 1142 + 300;
    expect(pageAtScroll(3, offsets(pages), { top: content - PAGE, height: PAGE, content })).toBe(3);
  });

  test("a single page is both the first and the last", () => {
    expect(pageAtScroll(1, offsets([0]), { top: 0, height: PAGE, content: PAGE })).toBe(1);
  });

  test("a long document is found without walking it", () => {
    let reads = 0;
    const pages = (index: number) => {
      reads += 1;
      return index * (PAGE + GAP);
    };
    const content = 400 * (PAGE + GAP);
    const page = pageAtScroll(400, pages, { top: 300 * (PAGE + GAP), height: PAGE, content });
    expect(page).toBe(301);
    expect(reads).toBeLessThan(20);
  });
});
