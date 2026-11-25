import { describe, expect, test } from "bun:test";
import { filterDocumentsByTag, pruneMissingTag } from "../src/documentTagFilter";
import type { PdfTag } from "../src/types/dto";

const tag = (id: number, name: string): PdfTag => ({
  id,
  name,
  pdf_tag_folder_id: null,
  created_at: 0,
  document_count: 0,
});

const document = (id: number, tagIds: number[]) => ({
  id,
  tags: tagIds.map((tagId) => ({ id: tagId })),
});

describe("filtering documents by tag", () => {
  test("no tag returns the list untouched", () => {
    const documents = [document(1, [10]), document(2, [])];
    expect(filterDocumentsByTag(documents, null)).toBe(documents);
  });

  test("only the documents carrying that tag stay", () => {
    const documents = [
      document(1, [10, 11]),
      document(2, [10]),
      document(3, [11]),
      document(4, []),
    ];
    expect(filterDocumentsByTag(documents, 10).map((entry) => entry.id)).toEqual([1, 2]);
    expect(filterDocumentsByTag(documents, 11).map((entry) => entry.id)).toEqual([1, 3]);
    expect(filterDocumentsByTag(documents, 12)).toEqual([]);
  });

  test("a document is matched by any one of its tags, not only the first", () => {
    const documents = [document(1, [10, 11])];
    expect(filterDocumentsByTag(documents, 11).map((entry) => entry.id)).toEqual([1]);
  });
});

describe("pruning the filter's tag", () => {
  test("a tag still in the catalogue keeps the filter", () => {
    expect(pruneMissingTag(3, [tag(1, "A"), tag(3, "C")])).toBe(3);
  });

  test("a tag that is gone drops the filter", () => {
    expect(pruneMissingTag(9, [tag(1, "A"), tag(3, "C")])).toBeNull();
  });

  test("no filter stays no filter", () => {
    expect(pruneMissingTag(null, [tag(1, "A")])).toBeNull();
  });
});
