import { describe, expect, test } from "bun:test";
import {
  anyFolderExpanded,
  expandGroup,
  nextFolderAction,
  setAllFoldersCollapsed,
  toggleGroup,
} from "../src/folderCollapse";

const folders = [1, 2];
const none = new Set<number | null>();
const all = new Set<number | null>([1, 2]);

describe("the collapse/expand button", () => {
  test("starts as collapse all, because folders start open", () => {
    expect(anyFolderExpanded(folders, none)).toBe(true);
    expect(nextFolderAction(folders, none)).toBe("collapse");
  });

  test("stays collapse all while any folder is open", () => {
    expect(nextFolderAction(folders, new Set([1]))).toBe("collapse");
  });

  test("becomes expand all only once every folder is closed", () => {
    expect(anyFolderExpanded(folders, all)).toBe(false);
    expect(nextFolderAction(folders, all)).toBe("expand");
  });

  test("has nothing to expand without folders", () => {
    expect(nextFolderAction([], none)).toBe("expand");
  });

  test("closes and opens every folder without touching the no-folder group", () => {
    const withUnfiledClosed = new Set<number | null>([null]);
    const closed = setAllFoldersCollapsed(withUnfiledClosed, folders, true);
    expect([closed.has(1), closed.has(2), closed.has(null)]).toEqual([true, true, true]);

    const reopened = setAllFoldersCollapsed(closed, folders, false);
    // Every folder is open again, and the "No folder" section keeps its own state.
    expect([reopened.has(1), reopened.has(2), reopened.has(null)]).toEqual([false, false, true]);
  });
});

describe("one group at a time", () => {
  test("toggles a folder either way", () => {
    const closed = toggleGroup(none, 1);
    expect(closed.has(1)).toBe(true);
    expect(toggleGroup(closed, 1).has(1)).toBe(false);
  });

  test("expands without disturbing the others", () => {
    const next = expandGroup(new Set([1, 2]), 2);
    expect(next.has(1)).toBe(true);
    expect(next.has(2)).toBe(false);
  });

  test("expanding an open group keeps the same set", () => {
    expect(expandGroup(none, 1)).toBe(none as Set<number | null>);
  });
});
