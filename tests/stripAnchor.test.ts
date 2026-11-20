import { describe, expect, test } from "bun:test";
import type { LoadedPage } from "../src/pdf";
import { MAX_EXCERPT, excerptFromRuns, savedStripGeometry, type SavedStripGeometry } from "../src/stripAnchor";

/** A page with just enough shape for the geometry helpers. */
function makePage(width: number, height: number, lines: string[][]): LoadedPage {
  let fullText = "";
  const runs = lines.flatMap((line, lineIndex) =>
    line.map((text, columnIndex) => {
      const start = fullText.length;
      fullText += text;
      return {
        start,
        end: start + text.length,
        left: 72 + columnIndex * 200,
        top: 100 + lineIndex * 20,
        width: 180,
        height: 14,
      };
    }),
  );

  return {
    index: 3,
    width,
    height,
    text: { pageIndex: 3, fullText, runs },
  } as unknown as LoadedPage;
}

describe("savedStripGeometry", () => {
  test("records the page number and page size in PDF points", () => {
    const geometry = savedStripGeometry(makePage(595, 842, [["Hello"], ["world"]]), 112, 40);

    expect(geometry.page_number).toBe(3);
    expect(geometry.page_width).toBe(595);
    expect(geometry.page_height).toBe(842);
  });

  test("centres the band on the given line and keeps its height", () => {
    const geometry = savedStripGeometry(makePage(595, 842, [["one"], ["two"], ["three"]]), 130, 40);

    expect(geometry.top).toBe(110);
    expect(geometry.height).toBe(40);
  });

  test("clamps the band to the top of the page instead of going negative", () => {
    const geometry = savedStripGeometry(makePage(595, 842, [["near the top"]]), 5, 40);

    expect(geometry.top).toBe(0);
    expect(geometry.height).toBe(40);
  });

  test("clamps the band to the bottom of the page", () => {
    const geometry = savedStripGeometry(makePage(595, 842, [["last line"]]), 841, 40);

    expect(geometry.top + geometry.height).toBe(842);
  });

  test("takes the column edges from the runs the band covers", () => {
    const page = makePage(595, 842, [["outside above"], ["inside"], ["outside below"]]);

    const geometry = savedStripGeometry(page, 124, 20);

    expect(geometry.left).toBe(72);
    expect(geometry.width).toBe(180);
  });

  test("falls back to the full page width when no text sits under the band", () => {
    const page = makePage(595, 842, [["far away"]]);

    const geometry = savedStripGeometry(page, 700, 20);

    expect(geometry.left).toBe(0);
    expect(geometry.width).toBe(595);
    expect(geometry.text_excerpt).toBeNull();
  });

  test("keeps the geometry rounded to two decimals", () => {
    const page = makePage(595.123456, 842.987654, [["text"]]);

    const geometry = savedStripGeometry(page, 105.555555, 33.333333);

    for (const value of [geometry.top, geometry.height, geometry.left, geometry.page_width, geometry.page_height]) {
      expect(String(value).split(".")[1]?.length ?? 0).toBeLessThan(3);
    }
  });
});

describe("excerptFromRuns", () => {
  test("joins the covered runs in reading order", () => {
    const page = makePage(595, 842, [["First", "line"], ["Second"]]);

    const excerpt = excerptFromRuns(page, page.text.runs);

    expect(excerpt).toBe("First line Second");
  });

  test("cuts the excerpt at the limit and trims the tail", () => {
    const long = "word ".repeat(100).trim();
    const page = makePage(595, 842, [[long]]);

    const excerpt = excerptFromRuns(page, page.text.runs);

    // Cut at the limit, then trimmed, so the length is at most the limit but the
    // text is always a prefix of the original.
    expect(excerpt).not.toBeNull();
    expect(excerpt?.length).toBeLessThanOrEqual(MAX_EXCERPT);
    expect(excerpt?.endsWith(" ")).toBe(false);
    expect(long.startsWith(excerpt ?? "")).toBe(true);
  });

  test("respects a custom limit", () => {
    const page = makePage(595, 842, [["abcdefghij"]]);

    expect(excerptFromRuns(page, page.text.runs, 4)).toBe("abcd");
  });

  test("returns null when there is nothing to quote", () => {
    const page = makePage(595, 842, []);

    expect(excerptFromRuns(page, page.text.runs)).toBeNull();
  });
});

describe("the saved record shape", () => {
  test("matches the fields the API expects for a new strip", () => {
    const geometry: SavedStripGeometry = savedStripGeometry(makePage(595, 842, [["text"]]), 107, 20);

    expect(Object.keys(geometry).sort()).toEqual([
      "height",
      "left",
      "page_height",
      "page_number",
      "page_width",
      "text_excerpt",
      "top",
      "width",
    ]);
  });
});
