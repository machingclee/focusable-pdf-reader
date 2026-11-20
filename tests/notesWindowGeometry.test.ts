import { describe, expect, test } from "bun:test";
import {
  MIN_NOTES_WINDOW_HEIGHT,
  MIN_NOTES_WINDOW_WIDTH,
  loadNotesWindowRect,
  saveNotesWindowRect,
  type RectStorage,
} from "../src/notesWindowGeometry";

/** The two `Storage` methods this module uses, backed by a Map. */
function memoryStorage(seed: Record<string, string> = {}): RectStorage & { entries: Map<string, string> } {
  const entries = new Map(Object.entries(seed));
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}

describe("loadNotesWindowRect", () => {
  test("round-trips what was saved", () => {
    const storage = memoryStorage();
    const rect = { x: 120, y: 80, width: 420, height: 780 };

    saveNotesWindowRect(rect, storage);
    expect(loadNotesWindowRect(storage)).toEqual(rect);
  });

  test("rounds the fractions a logical conversion can leave behind", () => {
    const storage = memoryStorage();
    saveNotesWindowRect({ x: 10.4, y: 20.6, width: 400.5, height: 700.4 }, storage);
    expect(loadNotesWindowRect(storage)).toEqual({ x: 10, y: 21, width: 401, height: 700 });
  });

  test("has nothing to restore on the first run", () => {
    expect(loadNotesWindowRect(memoryStorage())).toBeNull();
  });

  test("rejects a rectangle it cannot trust", () => {
    const cases = [
      "not json",
      "null",
      "[]",
      JSON.stringify({ x: 1, y: 2, width: "400", height: 700 }),
      JSON.stringify({ x: Number.NaN, y: 2, width: 400, height: 700 }),
      JSON.stringify({ width: 400, height: 700 }),
      // Below the window's own minimums, so it could not be used as it is.
      JSON.stringify({ x: 1, y: 2, width: MIN_NOTES_WINDOW_WIDTH - 1, height: 700 }),
      JSON.stringify({ x: 1, y: 2, width: 400, height: MIN_NOTES_WINDOW_HEIGHT - 1 }),
    ];
    for (const raw of cases) {
      expect(loadNotesWindowRect(memoryStorage({ "notes-window-rect-v1": raw }))).toBeNull();
    }
  });

  test("accepts a rectangle exactly at the minimums", () => {
    const raw = JSON.stringify({
      x: 0,
      y: 0,
      width: MIN_NOTES_WINDOW_WIDTH,
      height: MIN_NOTES_WINDOW_HEIGHT,
    });
    expect(loadNotesWindowRect(memoryStorage({ "notes-window-rect-v1": raw }))).toEqual({
      x: 0,
      y: 0,
      width: MIN_NOTES_WINDOW_WIDTH,
      height: MIN_NOTES_WINDOW_HEIGHT,
    });
  });

  test("storage that throws is not an error worth propagating", () => {
    const broken: RectStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadNotesWindowRect(broken)).toBeNull();
    expect(() => saveNotesWindowRect({ x: 0, y: 0, width: 400, height: 700 }, broken)).not.toThrow();
  });
});

describe("saveNotesWindowRect", () => {
  test("overwrites the previous rectangle", () => {
    const storage = memoryStorage();
    saveNotesWindowRect({ x: 0, y: 0, width: 380, height: 760 }, storage);
    saveNotesWindowRect({ x: 40, y: 60, width: 500, height: 800 }, storage);

    expect(storage.entries.size).toBe(1);
    expect(loadNotesWindowRect(storage)).toEqual({ x: 40, y: 60, width: 500, height: 800 });
  });
});
