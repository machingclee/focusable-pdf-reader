import { describe, expect, test } from "bun:test";
import { historyShortcut, isEditableShortcutTarget, type ShortcutKey } from "../src/historyShortcut";

const key = (over: Partial<ShortcutKey> & { code: string }): ShortcutKey => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe("historyShortcut", () => {
  test("Command+Z undoes and Command+Y redoes", () => {
    expect(historyShortcut(key({ code: "KeyZ", metaKey: true }))).toBe("undo");
    expect(historyShortcut(key({ code: "KeyY", metaKey: true }))).toBe("redo");
  });

  test("Command+Shift+Z also redoes", () => {
    expect(historyShortcut(key({ code: "KeyZ", metaKey: true, shiftKey: true }))).toBe("redo");
  });

  test("Control works as Command", () => {
    expect(historyShortcut(key({ code: "KeyZ", ctrlKey: true }))).toBe("undo");
    expect(historyShortcut(key({ code: "KeyY", ctrlKey: true }))).toBe("redo");
  });

  test("Option and a bare letter are left alone", () => {
    expect(historyShortcut(key({ code: "KeyZ", metaKey: true, altKey: true }))).toBeNull();
    expect(historyShortcut(key({ code: "KeyZ" }))).toBeNull();
    expect(historyShortcut(key({ code: "KeyY", shiftKey: true, metaKey: true }))).toBeNull();
  });

  test("a press with no element is not an editor", () => {
    expect(isEditableShortcutTarget(null)).toBe(false);
  });
});
