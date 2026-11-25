import { describe, expect, test } from "bun:test";
import { filterDocumentsByTags, groupTagsByFolder, pruneMissingTags } from "../src/documentTagFilter";
import type { PdfTag, PdfTagFolder } from "../src/types/dto";

const tag = (id: number, name: string, folder: number | null = null): PdfTag => ({
  id,
  name,
  pdf_tag_folder_id: folder,
  created_at: 0,
  document_count: 0,
});

const folder = (id: number, name: string): PdfTagFolder => ({
  id,
  name,
  ordering: id,
  created_at: 0,
});

const document = (id: number, tagIds: number[]) => ({
  id,
  tags: tagIds.map((tagId) => ({ id: tagId })),
});

describe("filtering documents by tag", () => {
  test("no selection returns the list untouched", () => {
    const documents = [document(1, [10]), document(2, [])];
    expect(filterDocumentsByTags(documents, [])).toBe(documents);
  });

  test("a document must carry every selected tag", () => {
    const documents = [document(1, [10, 11]), document(2, [10]), document(3, [11])];
    expect(filterDocumentsByTags(documents, [10]).map((entry) => entry.id)).toEqual([1, 2]);
    expect(filterDocumentsByTags(documents, [10, 11]).map((entry) => entry.id)).toEqual([1]);
  });

  test("selection order does not matter", () => {
    const documents = [document(1, [10, 11])];
    expect(filterDocumentsByTags(documents, [11, 10]).map((entry) => entry.id)).toEqual([1]);
  });
});

describe("grouping tags by folder", () => {
  test("folders keep their order and ungrouped comes last", () => {
    const groups = groupTagsByFolder(
      [tag(1, "Rust", 2), tag(2, "Loose"), tag(3, "Go", 1)],
      [folder(1, "Languages"), folder(2, "Topics")],
    );
    expect(groups.map((group) => group.name)).toEqual(["Languages", "Topics", "Ungrouped"]);
    expect(groups.map((group) => group.tags.map((entry) => entry.name))).toEqual([
      ["Go"],
      ["Rust"],
      ["Loose"],
    ]);
  });

  test("an empty folder is still listed", () => {
    const groups = groupTagsByFolder([], [folder(1, "Languages")]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.tags).toEqual([]);
  });
});

describe("pruning a selection", () => {
  test("ids whose tag is gone are dropped, the rest keep their order", () => {
    expect(pruneMissingTags([3, 1, 9], [tag(1, "A"), tag(3, "C")])).toEqual([3, 1]);
  });
});
