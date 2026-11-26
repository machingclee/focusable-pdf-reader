import { describe, expect, test } from "bun:test";
import { planFolderReorder, planStripDrop, planSubsetReorder } from "../src/stripOrder";

// A folder, another folder, and the strips that are in no folder (`id: null`).
const folders = [
  { id: 1, note_ids: [10, 11] },
  { id: 2, note_ids: [20] },
  { id: null, note_ids: [30] },
];

describe("planFolderReorder", () => {
  test("moves a folder to the drop index", () => {
    expect(planFolderReorder([1, 2, 3], 1, 3)).toEqual([2, 3, 1]);
  });

  test("ignores a drop on the same folder", () => {
    expect(planFolderReorder([1, 2], 2, 2)).toBeNull();
  });
});

describe("planSubsetReorder", () => {
  test("moves a visible row and leaves a hidden one where it was", () => {
    expect(planSubsetReorder([1, 2, 3, 4], [2, 4], 4, 2)).toEqual([1, 4, 3, 2]);
  });

  test("is a plain move when every row is on screen", () => {
    expect(planSubsetReorder([1, 2, 3], [1, 2, 3], 1, 3)).toEqual([2, 3, 1]);
  });

  test("ignores a drop on the same row", () => {
    expect(planSubsetReorder([1, 2], [1, 2], 1, 1)).toBeNull();
  });
});

describe("planStripDrop", () => {
  test("reorders strips inside one folder", () => {
    expect(planStripDrop(folders, 11, { type: "strip", id: 10 })).toEqual([
      { note_folder_id: 1, note_ids: [11, 10] },
    ]);
  });

  test("inserts a strip into another folder at the target strip", () => {
    expect(planStripDrop(folders, 10, { type: "strip", id: 20 })).toEqual([
      { note_folder_id: 1, note_ids: [11] },
      { note_folder_id: 2, note_ids: [10, 20] },
    ]);
  });

  test("appends a strip dropped on another folder", () => {
    expect(planStripDrop(folders, 11, { type: "folder", id: 2 })).toEqual([
      { note_folder_id: 1, note_ids: [10] },
      { note_folder_id: 2, note_ids: [20, 11] },
    ]);
  });

  test("ignores a drop on the strip's own folder", () => {
    expect(planStripDrop(folders, 10, { type: "folder", id: 1 })).toBeNull();
  });

  test("moves a strip out of every folder", () => {
    expect(planStripDrop(folders, 10, { type: "folder", id: null })).toEqual([
      { note_folder_id: 1, note_ids: [11] },
      { note_folder_id: null, note_ids: [30, 10] },
    ]);
  });

  test("files a strip that was in no folder", () => {
    expect(planStripDrop(folders, 30, { type: "folder", id: 2 })).toEqual([
      { note_folder_id: null, note_ids: [] },
      { note_folder_id: 2, note_ids: [20, 30] },
    ]);
  });

  test("drops a folder-less strip onto another folder-less strip", () => {
    const two = [...folders.slice(0, 2), { id: null, note_ids: [30, 31] }];
    expect(planStripDrop(two, 31, { type: "strip", id: 30 })).toEqual([
      { note_folder_id: null, note_ids: [31, 30] },
    ]);
  });

  test("ignores a drop on the no-folder header when the strip is already there", () => {
    expect(planStripDrop(folders, 30, { type: "folder", id: null })).toBeNull();
  });
});
