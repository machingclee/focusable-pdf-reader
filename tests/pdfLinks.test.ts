import { describe, expect, test } from "bun:test";
import {
  destinationScrollPoint,
  isOpenablePdfUrl,
  resolvePdfLinkDestination,
  spanIsLinkText,
  type DestPage,
  type PdfDestDocument,
} from "../src/pdfLinks";

/** A page whose user space starts at the bottom-left and is not rotated. */
function uprightPage(width: number, height: number): DestPage {
  return {
    getViewport() {
      return {
        width,
        height,
        rotation: 0,
        convertToViewportPoint(x, y) {
          return [x, height - y];
        },
      };
    },
  };
}

describe("destinationScrollPoint", () => {
  const page = uprightPage(612, 792);

  test("XYZ puts the named point at the top of the window", () => {
    expect(destinationScrollPoint([null, { name: "XYZ" }, 72, 700, null], page)).toEqual({
      left: 72,
      top: 92,
    });
  });

  test("a missing XYZ y is the top of the page", () => {
    expect(destinationScrollPoint([null, { name: "XYZ" }, 0, null, 0], page)).toEqual({
      left: 0,
      top: 0,
    });
  });

  test("a destination kind may be a bare name", () => {
    expect(destinationScrollPoint([null, "FitH", 400], page)).toEqual({
      left: 0,
      top: 392,
    });
  });

  test("Fit names the top of the page and no point", () => {
    expect(destinationScrollPoint([null, { name: "Fit" }], page)).toBeNull();
  });

  test("FitR scrolls to the top-left of the rectangle", () => {
    expect(destinationScrollPoint([null, { name: "FitR" }, 10, 100, 200, 300], page)).toEqual({
      left: 10,
      top: 492,
    });
  });

  test("an unknown kind is left alone", () => {
    expect(destinationScrollPoint([null, { name: "Nope" }], page)).toBeNull();
  });

  test("a rotated page measures its height before the rotation", () => {
    let seenY = -1;
    const rotated: DestPage = {
      getViewport() {
        return {
          width: 600,
          height: 800,
          rotation: 90,
          convertToViewportPoint(_x, y) {
            seenY = y;
            return [0, 0];
          },
        };
      },
    };
    destinationScrollPoint([null, { name: "XYZ" }, 0, null, null], rotated);
    expect(seenY).toBe(600);
  });
});

describe("resolvePdfLinkDestination", () => {
  const page = uprightPage(600, 800);

  function document(partial: Partial<PdfDestDocument> = {}): PdfDestDocument {
    return {
      numPages: 3,
      getDestination: async () => null,
      getPageIndex: async () => 0,
      cachedPageNumber: () => null,
      ...partial,
    };
  }

  test("a named destination resolves to that page and point", async () => {
    const target = await resolvePdfLinkDestination(
      document({
        getDestination: async (id) =>
          id === "chap" ? [{ num: 4, gen: 0 }, { name: "XYZ" }, 10, 500, null] : null,
        cachedPageNumber: () => 2,
      }),
      "chap",
      () => page,
    );
    expect(target).toEqual({ pageNumber: 2, point: { left: 10, top: 300 } });
  });

  test("an integer page ref is zero-based", async () => {
    const target = await resolvePdfLinkDestination(
      document(),
      [1, { name: "Fit" }],
      (pageNumber) => (pageNumber === 2 ? page : null),
    );
    expect(target).toEqual({ pageNumber: 2, point: null });
  });

  test("a name the document does not have changes nothing", async () => {
    const target = await resolvePdfLinkDestination(document(), "missing", () => page);
    expect(target).toBeNull();
  });

  test("a page past the end changes nothing", async () => {
    const target = await resolvePdfLinkDestination(document(), [9, { name: "Fit" }], () => page);
    expect(target).toBeNull();
  });
});

describe("spanIsLinkText", () => {
  const link = { left: 40, top: 100, right: 160, bottom: 120 };

  test("a word whose centre sits in the link is the link", () => {
    expect(spanIsLinkText({ left: 50, top: 102, right: 90, bottom: 118 }, link)).toBe(true);
  });

  test("the rest of the line, only touching the link, stays ordinary text", () => {
    expect(spanIsLinkText({ left: 170, top: 102, right: 240, bottom: 118 }, link)).toBe(false);
  });

  test("an empty span is not a word", () => {
    expect(spanIsLinkText({ left: 50, top: 110, right: 50, bottom: 110 }, link)).toBe(false);
  });
});

describe("isOpenablePdfUrl", () => {
  test("http(s), mailto, tel and file may leave the webview", () => {
    expect(isOpenablePdfUrl("https://example.com/a")).toBe(true);
    expect(isOpenablePdfUrl("mailto:a@b.c")).toBe(true);
    expect(isOpenablePdfUrl("file:///tmp/a.pdf")).toBe(true);
  });

  test("script and hash URLs stay in the viewer", () => {
    expect(isOpenablePdfUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenablePdfUrl("#page=2")).toBe(false);
    expect(isOpenablePdfUrl("not a url")).toBe(false);
  });
});
