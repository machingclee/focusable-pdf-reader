import { describe, expect, test } from "bun:test";
import {
  anyFolderOpen,
  nextFolderAction,
  openGroup,
  setAllFoldersOpen,
  toggleGroup,
} from "../src/folderCollapse";

const folders = [1, 2];
/** Nobody has opened anything: the list's starting state. */
const none = new Set<number | null>();
const all = new Set<number | null>([1, 2]);

describe("the collapse/expand button", () => {
  test("starts as expand all, because folders start closed", () => {
    expect(anyFolderOpen(folders, none)).toBe(false);
    expect(nextFolderAction(folders, none)).toBe("expand");
  });

  test("stays expand all while any folder is closed", () => {
    expect(nextFolderAction(folders, new Set([1]))).toBe("expand");
  });

  test("becomes collapse all only once every folder is open", () => {
    expect(anyFolderOpen(folders, all)).toBe(true);
    expect(nextFolderAction(folders, all)).toBe("collapse");
  });

  test("has nothing to collapse without folders", () => {
    expect(nextFolderAction([], none)).toBe("expand");
  });

  test("opens and closes every folder without touching the no-folder group", () => {
    const withUnfiledOpen = new Set<number | null>([null]);
    const opened = setAllFoldersOpen(withUnfiledOpen, folders, true);
    expect([opened.has(1), opened.has(2), opened.has(null)]).toEqual([true, true, true]);

    const closed = setAllFoldersOpen(opened, folders, false);
    // Every folder is closed again, and the "No folder" section keeps its own state.
    expect([closed.has(1), closed.has(2), closed.has(null)]).toEqual([false, false, true]);
  });
});

describe("one group at a time", () => {
  test("toggles a folder either way", () => {
    const opened = toggleGroup(none, 1);
    expect(opened.has(1)).toBe(true);
    expect(toggleGroup(opened, 1).has(1)).toBe(false);
  });

  test("opens without disturbing the others", () => {
    const next = openGroup(new Set([1]), 2);
    expect(next.has(1)).toBe(true);
    expect(next.has(2)).toBe(true);
  });

  test("opening an already open group keeps the same set", () => {
    const open = new Set<number | null>([1]);
    expect(openGroup(open, 1)).toBe(open as Set<number | null>);
  });
});
