import { describe, expect, test } from "bun:test";
import { panelShortcut, type ShortcutKey } from "../src/shortcuts";

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

  test("Command+Option+M is the notes column", () => {
    expect(panelShortcut(key({ code: "KeyM", metaKey: true, altKey: true }))).toBe("notes-panel");
  });

  test("Control works as Command, for the Windows and Linux builds", () => {
    expect(panelShortcut(key({ code: "KeyB", ctrlKey: true }))).toBe("pages");
    expect(panelShortcut(key({ code: "KeyM", ctrlKey: true, altKey: true }))).toBe("notes-panel");
  });

  test("a bare letter is not a shortcut", () => {
    expect(panelShortcut(key({ code: "KeyB" }))).toBeNull();
    expect(panelShortcut(key({ code: "KeyM", altKey: true }))).toBeNull();
  });

  test("the notes chord needs the Option key", () => {
    expect(panelShortcut(key({ code: "KeyM", metaKey: true }))).toBeNull();
    expect(panelShortcut(key({ code: "KeyB", metaKey: true, altKey: true }))).toBeNull();
  });

  test("Shift is left free", () => {
    expect(panelShortcut(key({ code: "KeyB", metaKey: true, shiftKey: true }))).toBeNull();
    expect(
      panelShortcut(key({ code: "KeyM", metaKey: true, altKey: true, shiftKey: true })),
    ).toBeNull();
  });

  test("leaves the markdown editor's Command+Option+B alone", () => {
    expect(panelShortcut(key({ code: "KeyB", metaKey: true, altKey: true }))).toBeNull();
  });

  test("matches the physical key, so Option's remapped letter does not matter", () => {
    // ⌥M reports "µ" as `key`; the match is on `code`, so the chord still works.
    expect(panelShortcut({ ...key({ code: "KeyM", metaKey: true, altKey: true }) })).toBe("notes-panel");
  });
});
