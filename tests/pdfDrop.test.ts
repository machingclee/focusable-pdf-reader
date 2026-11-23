import { describe, expect, test } from "bun:test";
import {
  dragTypesIncludeFiles,
  isPdfFile,
  isPdfPath,
  pdfPaths,
  showPdfDropVeil,
} from "../src/pdfDrop";

describe("isPdfPath", () => {
  test("accepts a pdf regardless of case", () => {
    expect(isPdfPath("/Users/me/Notes.PDF")).toBe(true);
    expect(isPdfPath("C:\\Books\\chapter.pdf")).toBe(true);
  });

  test("refuses a file that only looks like one", () => {
    expect(isPdfPath("/Users/me/notes.pdf.txt")).toBe(false);
    expect(isPdfPath("/Users/me/photo.png")).toBe(false);
  });
});

describe("isPdfFile", () => {
  test("trusts the pdf mime type when the name has no extension", () => {
    expect(isPdfFile({ type: "application/pdf", name: "download" })).toBe(true);
  });

  test("falls back to the name", () => {
    expect(isPdfFile({ type: "", name: "chapter.PDF" })).toBe(true);
    expect(isPdfFile({ type: "image/png", name: "scan.png" })).toBe(false);
  });
});

describe("pdfPaths", () => {
  test("keeps the pdfs in drop order", () => {
    expect(pdfPaths(["/a/notes.txt", "/a/one.pdf", "/a/two.PDF", "/a/pic.png"])).toEqual([
      "/a/one.pdf",
      "/a/two.PDF",
    ]);
  });
});

describe("showPdfDropVeil", () => {
  test("covers the window when a pdf is in the drag", () => {
    expect(showPdfDropVeil(["/a/pic.png", "/a/book.pdf"])).toBe(true);
  });

  test("stays down for a drag that is only other files", () => {
    expect(showPdfDropVeil(["/a/pic.png"])).toBe(false);
  });

  test("covers the window when the drag has not named its files yet", () => {
    expect(showPdfDropVeil([])).toBe(true);
  });
});

describe("dragTypesIncludeFiles", () => {
  test("recognises an OS file drag", () => {
    expect(dragTypesIncludeFiles(["Files"])).toBe(true);
    expect(dragTypesIncludeFiles(["text/plain"])).toBe(false);
  });
});
