import { describe, expect, test } from "bun:test";
import { pageLayoutToSave, savePrefs } from "../src/prefs";

const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => {
    memory.set(key, value);
  },
  removeItem: (key) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
  key: () => null,
  get length() {
    return memory.size;
  },
} as Storage;

describe("pageLayoutToSave", () => {
  test("a reference viewer keeps the layout the other windows stored", () => {
    savePrefs({ stripBase: 160, stripBlur: 5, pageLayout: "two", recents: [] });
    expect(pageLayoutToSave("single", true)).toBe("two");
  });

  test("any other window writes the layout it is showing", () => {
    savePrefs({ stripBase: 160, stripBlur: 5, pageLayout: "two", recents: [] });
    expect(pageLayoutToSave("single", false)).toBe("single");
  });
});
