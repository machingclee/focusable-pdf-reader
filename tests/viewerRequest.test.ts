import { describe, expect, test } from "bun:test";
import { parseViewerRequest } from "../src/viewerRequest";

describe("parseViewerRequest", () => {
  test("reads the document and the note out of the window's query string", () => {
    expect(parseViewerRequest("?view=viewer&document=%2Fbooks%2FDeep%20Work.pdf&note=12")).toEqual({
      filePath: "/books/Deep Work.pdf",
      noteId: 12,
      annotationId: null,
    });
  });

  test("reads the annotation a `[annotation:<id>]` reference opened", () => {
    expect(parseViewerRequest("?view=viewer&document=%2Fa.pdf&annotation=7")).toEqual({
      filePath: "/a.pdf",
      noteId: null,
      annotationId: 7,
    });
  });

  test("reads a document opened in a window of its own as having nothing to stand on", () => {
    // "Open PDF in new window": the viewer opens the document and parks nothing.
    expect(parseViewerRequest("?view=viewer&document=%2Fa.pdf")).toEqual({
      filePath: "/a.pdf",
      noteId: null,
      annotationId: null,
    });
  });

  test("is null in every window that is not a viewer", () => {
    // The main window, the popped-out notes column, and a viewer with no document.
    expect(parseViewerRequest("")).toBeNull();
    expect(parseViewerRequest("?view=notes")).toBeNull();
    expect(parseViewerRequest("?view=viewer")).toBeNull();
    // A documented note with no viewer flag is still the main window.
    expect(parseViewerRequest("?document=%2Fa.pdf&note=12")).toBeNull();
  });

  test("refuses a note id that cannot be a strip", () => {
    for (const note of ["0", "-1", "1.5", "abc", ""]) {
      expect(parseViewerRequest(`?view=viewer&document=%2Fa.pdf&note=${note}`)).toBeNull();
    }
  });

  test("refuses an annotation id that cannot be a row", () => {
    for (const annotation of ["0", "-1", "1.5", "abc", ""]) {
      expect(parseViewerRequest(`?view=viewer&document=%2Fa.pdf&annotation=${annotation}`)).toBeNull();
    }
  });

  test("refuses a window that names both a note and an annotation", () => {
    // Two places to go and no rule for which wins: the window is not one this app
    // builds, so it is refused rather than half-followed.
    expect(parseViewerRequest("?view=viewer&document=%2Fa.pdf&note=1&annotation=2")).toBeNull();
  });
});
