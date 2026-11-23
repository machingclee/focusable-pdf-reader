import { describe, expect, test } from "bun:test";
import { parseViewerRequest } from "../src/viewerRequest";

describe("parseViewerRequest", () => {
  test("reads the document and the note out of the window's query string", () => {
    expect(parseViewerRequest("?view=viewer&document=%2Fbooks%2FDeep%20Work.pdf&note=12")).toEqual({
      filePath: "/books/Deep Work.pdf",
      noteId: 12,
    });
  });

  test("is null in every window that is not a reference viewer", () => {
    // The main window, the popped-out notes column, and a viewer without a note.
    expect(parseViewerRequest("")).toBeNull();
    expect(parseViewerRequest("?view=notes")).toBeNull();
    expect(parseViewerRequest("?view=viewer")).toBeNull();
    expect(parseViewerRequest("?view=viewer&document=%2Fa.pdf")).toBeNull();
    // A document with no note to stand on is an ordinary open, not a reference.
    expect(parseViewerRequest("?document=%2Fa.pdf&note=12")).toBeNull();
  });

  test("refuses a note id that cannot be a strip", () => {
    for (const note of ["0", "-1", "1.5", "abc", ""]) {
      expect(parseViewerRequest(`?view=viewer&document=%2Fa.pdf&note=${note}`)).toBeNull();
    }
  });
});
