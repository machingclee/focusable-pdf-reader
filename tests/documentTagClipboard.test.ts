import { describe, expect, test } from "bun:test";
import { copyDocumentTags, copiedDocumentTags } from "../src/documentTagClipboard";

describe("the copied tag set", () => {
  test("what one document copies is what the next document pastes", () => {
    copyDocumentTags({ documentId: 7, documentName: "Rust book" });
    expect(copiedDocumentTags()).toEqual({ documentId: 7, documentName: "Rust book" });
  });

  test("a second copy replaces the first", () => {
    copyDocumentTags({ documentId: 7, documentName: "Rust book" });
    copyDocumentTags({ documentId: 3, documentName: "Draft" });
    expect(copiedDocumentTags()).toEqual({ documentId: 3, documentName: "Draft" });
  });
});
