import { describe, expect, test } from "bun:test";
import {
  MAX_NOTE_EDITOR_HEIGHT,
  MIN_NOTE_EDITOR_HEIGHT,
  clampNoteEditorHeight,
  noteEditorStartHeight,
} from "../src/noteEditorHeight";

describe("clampNoteEditorHeight", () => {
  test("a one-line note opens a field you can read a paragraph in", () => {
    // The band's text can be a couple of words, and the Save/Cancel row under the
    // field must not be the tallest thing in the editor.
    expect(clampNoteEditorHeight(20)).toBe(MIN_NOTE_EDITOR_HEIGHT);
    expect(clampNoteEditorHeight(MIN_NOTE_EDITOR_HEIGHT - 1)).toBe(MIN_NOTE_EDITOR_HEIGHT);
    expect(clampNoteEditorHeight(MIN_NOTE_EDITOR_HEIGHT)).toBe(MIN_NOTE_EDITOR_HEIGHT);
  });

  test("a long note stops at the ceiling instead of pushing the column away", () => {
    expect(clampNoteEditorHeight(5000)).toBe(MAX_NOTE_EDITOR_HEIGHT);
    // Past the ceiling Monaco scrolls inside the frame; the frame itself stops here.
    expect(clampNoteEditorHeight(MAX_NOTE_EDITOR_HEIGHT + 1)).toBe(MAX_NOTE_EDITOR_HEIGHT);
  });

  test("a height between the two is used as measured, in whole pixels", () => {
    expect(clampNoteEditorHeight(300)).toBe(300);
    expect(clampNoteEditorHeight(240.6)).toBe(241);
    expect(clampNoteEditorHeight(95.4)).toBe(MIN_NOTE_EDITOR_HEIGHT);
  });
});

describe("noteEditorStartHeight", () => {
  test("a measured card starts at the height its note was read at", () => {
    // Double-clicking a note replaces the text with a field of the same size, so the
    // card does not resize under the pointer that just clicked it.
    expect(noteEditorStartHeight(212)).toBe(212);
    expect(noteEditorStartHeight(40)).toBe(MIN_NOTE_EDITOR_HEIGHT);
    expect(noteEditorStartHeight(900)).toBe(MAX_NOTE_EDITOR_HEIGHT);
  });

  test("a card with nothing to measure starts at the floor, never the ceiling", () => {
    // The regression: a strip saved from the band's **Save note** hands over no height,
    // and the frame used to start at the 640px ceiling. The card was 640px tall until
    // Monaco reported its (one-line, empty) content and then snapped back down — the
    // flash of a card filling the column that then collapsed.
    expect(noteEditorStartHeight(undefined)).toBe(MIN_NOTE_EDITOR_HEIGHT);
    expect(noteEditorStartHeight(undefined)).not.toBe(MAX_NOTE_EDITOR_HEIGHT);
  });

  test("a measurement that is not a number cannot leave the frame unsized", () => {
    // A card can be measured before it has been laid out (a folder that is still
    // closed), which reports 0 — and a broken measurement must not become a height.
    expect(noteEditorStartHeight(0)).toBe(MIN_NOTE_EDITOR_HEIGHT);
    expect(noteEditorStartHeight(Number.NaN)).toBe(MIN_NOTE_EDITOR_HEIGHT);
    expect(noteEditorStartHeight(Number.POSITIVE_INFINITY)).toBe(MIN_NOTE_EDITOR_HEIGHT);
  });
});
