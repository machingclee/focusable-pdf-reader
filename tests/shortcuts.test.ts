import { describe, expect, test } from "bun:test";
import { panelShortcut, scrollHistoryShortcut, type ShortcutKey } from "../src/shortcuts";

const key = (over: Partial<ShortcutKey> & { code: string }): ShortcutKey => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

describe("panelShortcut", () => {
  test("Command+B is the Pages rail", () => {
    expect(panelShortcut(key({ code: "KeyB", metaKey: true }))).toBe("pages");
  });

  test("Command+Option+B is the notes column", () => {
    expect(panelShortcut(key({ code: "KeyB", metaKey: true, altKey: true }))).toBe("notes-panel");
  });

  test("Control works as Command, for the Windows and Linux builds", () => {
    expect(panelShortcut(key({ code: "KeyB", ctrlKey: true }))).toBe("pages");
    expect(panelShortcut(key({ code: "KeyB", ctrlKey: true, altKey: true }))).toBe("notes-panel");
  });

  test("a bare letter is not a shortcut", () => {
    expect(panelShortcut(key({ code: "KeyB" }))).toBeNull();
    expect(panelShortcut(key({ code: "KeyB", altKey: true }))).toBeNull();
  });

  test("the notes chord needs the Option key", () => {
    expect(panelShortcut(key({ code: "KeyB", metaKey: true }))).toBe("pages");
    expect(panelShortcut(key({ code: "KeyM", metaKey: true, altKey: true }))).toBeNull();
  });

  test("Shift is left free", () => {
    expect(panelShortcut(key({ code: "KeyB", metaKey: true, shiftKey: true }))).toBeNull();
    expect(
      panelShortcut(key({ code: "KeyB", metaKey: true, altKey: true, shiftKey: true })),
    ).toBeNull();
  });

  test("Option+Left and Option+Right walk the scroll marks", () => {
    expect(scrollHistoryShortcut(key({ code: "ArrowLeft", altKey: true }))).toBe(-1);
    expect(scrollHistoryShortcut(key({ code: "ArrowRight", altKey: true }))).toBe(1);
    expect(scrollHistoryShortcut(key({ code: "ArrowLeft" }))).toBeNull();
    expect(scrollHistoryShortcut(key({ code: "ArrowLeft", altKey: true, metaKey: true }))).toBeNull();
    expect(scrollHistoryShortcut(key({ code: "ArrowRight", altKey: true, shiftKey: true }))).toBeNull();
  });

  test("matches the physical key, so Option's remapped letter does not matter", () => {
    // ⌥B reports "∫" as `key`; the match is on `code`, so the chord still works.
    expect(panelShortcut({ ...key({ code: "KeyB", metaKey: true, altKey: true }) })).toBe("notes-panel");
  });
});
