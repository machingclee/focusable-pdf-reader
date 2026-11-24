import { describe, expect, test } from "bun:test";
import { shortcutLabels } from "../src/shortcutHints";

describe("shortcutLabels", () => {
  test("Windows names the modifiers and joins them with +", () => {
    const hints = shortcutLabels("windows");
    expect(hints.mod).toBe("Ctrl");
    expect(hints.alt).toBe("Alt");
    expect(hints.shift).toBe("Shift");
    expect(hints.chord(hints.mod, "O")).toBe("Ctrl+O");
    expect(hints.chord(hints.mod, hints.alt, "B")).toBe("Ctrl+Alt+B");
    expect(hints.chord(hints.mod, hints.alt, hints.shift, "B")).toBe("Ctrl+Alt+Shift+B");
    expect(hints.chord(hints.alt, "←")).toBe("Alt+←");
  });

  test("macOS keeps the glyphs and runs the chord together", () => {
    const hints = shortcutLabels("macos");
    expect(hints.mod).toBe("⌘");
    expect(hints.alt).toBe("⌥");
    expect(hints.shift).toBe("⇧");
    expect(hints.chord(hints.mod, "O")).toBe("⌘O");
    expect(hints.chord(hints.mod, hints.alt, "B")).toBe("⌘⌥B");
    expect(hints.chord(hints.mod, hints.alt, hints.shift, "B")).toBe("⌘⌥⇧B");
    expect(hints.chord(hints.alt, "←")).toBe("⌥←");
  });

  test("the plain web build keeps the macOS hint", () => {
    expect(shortcutLabels("other").chord("⌘", "B")).toBe("⌘B");
  });
});
