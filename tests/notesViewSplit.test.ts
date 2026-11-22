import { describe, expect, test } from "bun:test";
import {
  DEFAULT_NOTES_VIEW_DOCUMENTS,
  MIN_NOTES_VIEW_DOCUMENTS,
  MIN_NOTES_VIEW_STRIPS,
  clampNotesViewDocumentsWidth,
  maxNotesViewDocumentsWidth,
} from "../src/notesViewSplit";

/** A comfortable window for the tab, in px. */
const TAB = 1400;

describe("maxNotesViewDocumentsWidth", () => {
  test("the notes beside the rail keep their minimum", () => {
    expect(maxNotesViewDocumentsWidth(TAB)).toBe(Math.round(TAB / 2));
    // Under twice the notes minimum the notes set the ceiling, not the
    // half-and-half rule: the cards need their width before the rail does.
    expect(maxNotesViewDocumentsWidth(500)).toBe(500 - MIN_NOTES_VIEW_STRIPS);
    // At twice that minimum the two rules meet, so either reading agrees.
    expect(maxNotesViewDocumentsWidth(MIN_NOTES_VIEW_STRIPS * 2)).toBe(MIN_NOTES_VIEW_STRIPS);
  });

  test("a small window still has room to widen the rail", () => {
    // The window the reader actually sizes down to: the seam has to be worth
    // taking hold of, so the ceiling leaves the rail more than its own floor.
    expect(maxNotesViewDocumentsWidth(534)).toBeGreaterThan(MIN_NOTES_VIEW_DOCUMENTS + 40);
  });

  test("the rail never takes more than half the tab", () => {
    // A wide window must not hand the rail most of the pane just because the
    // notes could still be squeezed into their minimum.
    for (const tab of [1200, 2000, 3000]) {
      expect(maxNotesViewDocumentsWidth(tab)).toBeLessThanOrEqual(Math.round(tab / 2) + 1);
    }
  });

  test("a tab narrower than both panes still yields a usable ceiling", () => {
    // 534 px is the smallest window the reader saw fit to resize to; the two
    // minimums add up to more than it, and the floor wins so the rail can be
    // dragged at all.
    for (const tab of [440, MIN_NOTES_VIEW_DOCUMENTS + MIN_NOTES_VIEW_STRIPS - 1]) {
      expect(maxNotesViewDocumentsWidth(tab)).toBeGreaterThanOrEqual(MIN_NOTES_VIEW_DOCUMENTS);
    }
  });

  test("rounds to whole pixels, and never under the minimum", () => {
    expect(maxNotesViewDocumentsWidth(1000.4)).toBe(500);
    expect(maxNotesViewDocumentsWidth(120)).toBe(MIN_NOTES_VIEW_DOCUMENTS);
  });

  test("an unmeasurable tab falls back rather than reporting zero", () => {
    for (const width of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(maxNotesViewDocumentsWidth(width)).toBeGreaterThan(MIN_NOTES_VIEW_DOCUMENTS);
    }
  });
});

describe("clampNotesViewDocumentsWidth", () => {
  test("a width inside the rules is kept as it is", () => {
    expect(clampNotesViewDocumentsWidth(320, 700)).toBe(320);
    expect(clampNotesViewDocumentsWidth(DEFAULT_NOTES_VIEW_DOCUMENTS, 700)).toBe(
      DEFAULT_NOTES_VIEW_DOCUMENTS,
    );
  });

  test("the rail never closes, however far it is dragged in", () => {
    // Unlike a docked column, the rail has no shut: it is the only way to pick a
    // document, so a drag towards the edge settles at the minimum.
    expect(clampNotesViewDocumentsWidth(0, 700)).toBe(MIN_NOTES_VIEW_DOCUMENTS);
    expect(clampNotesViewDocumentsWidth(-40, 700)).toBe(MIN_NOTES_VIEW_DOCUMENTS);
    expect(clampNotesViewDocumentsWidth(MIN_NOTES_VIEW_DOCUMENTS - 1, 700)).toBe(
      MIN_NOTES_VIEW_DOCUMENTS,
    );
  });

  test("a drag past what the notes can spare stops at the ceiling", () => {
    expect(clampNotesViewDocumentsWidth(2000, 700)).toBe(700);
    expect(clampNotesViewDocumentsWidth(700.4, 700)).toBe(700);
  });

  test("rounds to whole pixels", () => {
    expect(clampNotesViewDocumentsWidth(312.6, 700)).toBe(313);
    expect(clampNotesViewDocumentsWidth(312.4, 700)).toBe(312);
  });

  test("a ceiling narrower than the minimum still yields a usable width", () => {
    // The two limits cross on a tiny tab; the floor wins, or the rail would be
    // asked for a width it is not allowed to have.
    expect(clampNotesViewDocumentsWidth(400, 0)).toBe(MIN_NOTES_VIEW_DOCUMENTS);
    // An unmeasurable ceiling is the fallback, not "no ceiling at all".
    expect(clampNotesViewDocumentsWidth(400, Number.NaN)).toBe(400);
    expect(clampNotesViewDocumentsWidth(2000, Number.NaN)).toBe(480);
  });

  test("a width that is not a number falls back to the floor", () => {
    expect(clampNotesViewDocumentsWidth(Number.NaN, 700)).toBe(MIN_NOTES_VIEW_DOCUMENTS);
  });
});
