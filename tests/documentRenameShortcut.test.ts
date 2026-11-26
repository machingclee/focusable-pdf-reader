import { describe, expect, test } from "bun:test";
import { documentIdForRenameShortcut, type RenameShortcutTarget } from "../src/documentRenameShortcut";

function key(overrides: Partial<RenameShortcutTarget> = {}): RenameShortcutTarget {
  return {
    key: "Enter",
    repeat: false,
    composing: false,
    meta: false,
    ctrl: false,
    alt: false,
    shift: false,
    inColumn: true,
    focusOnPage: false,
    columnActive: true,
    blocked: false,
    foreignControl: false,
    editing: false,
    rowId: 7,
    selectedId: 4,
    isVisible: () => true,
    ...overrides,
  };
}

describe("documentIdForRenameShortcut", () => {
  test("Enter on a document row renames that row", () => {
    expect(documentIdForRenameShortcut(key())).toBe(7);
  });

  test("F2 on a document row renames that row", () => {
    expect(documentIdForRenameShortcut(key({ key: "F2" }))).toBe(7);
  });

  test("a key that missed the rows renames the highlighted document", () => {
    expect(documentIdForRenameShortcut(key({ rowId: null, focusOnPage: true, inColumn: false }))).toBe(4);
  });

  test("the row under the key wins over the highlight", () => {
    expect(documentIdForRenameShortcut(key({ rowId: 7, selectedId: 4 }))).toBe(7);
  });

  test("Enter outside the column does not rename", () => {
    expect(
      documentIdForRenameShortcut(key({ inColumn: false, columnActive: false, focusOnPage: false, rowId: null })),
    ).toBeNull();
  });

  test("Enter on the page does not rename when the column was not the last press", () => {
    expect(
      documentIdForRenameShortcut(key({ inColumn: false, columnActive: false, focusOnPage: true, rowId: null })),
    ).toBeNull();
  });

  test("a text field, another control, and an open menu keep the key", () => {
    expect(documentIdForRenameShortcut(key({ editing: true }))).toBeNull();
    expect(documentIdForRenameShortcut(key({ foreignControl: true, rowId: null }))).toBeNull();
    expect(documentIdForRenameShortcut(key({ blocked: true }))).toBeNull();
  });

  test("a modified Enter is left alone", () => {
    expect(documentIdForRenameShortcut(key({ meta: true }))).toBeNull();
    expect(documentIdForRenameShortcut(key({ shift: true }))).toBeNull();
  });

  test("a hidden document is not renamed", () => {
    expect(documentIdForRenameShortcut(key({ isVisible: () => false }))).toBeNull();
    expect(documentIdForRenameShortcut(key({ rowId: null, selectedId: null, focusOnPage: true, inColumn: false }))).toBeNull();
  });

  test("other keys do not rename", () => {
    expect(documentIdForRenameShortcut(key({ key: "ArrowDown" }))).toBeNull();
    expect(documentIdForRenameShortcut(key({ key: "F2", repeat: true }))).toBeNull();
    expect(documentIdForRenameShortcut(key({ composing: true }))).toBeNull();
  });
});
