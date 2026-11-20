import { describe, expect, test } from "bun:test";
import {
  CLOSE_NOTES_PANEL_BELOW,
  DEFAULT_NOTES_PANEL,
  MAX_NOTES_PANEL,
  MIN_NOTES_PANEL,
  resolveNotesPanelDrag,
  restoredNotesPanelWidth,
} from "../src/notesPanel";

describe("resolveNotesPanelDrag", () => {
  test("widening keeps the dragged width", () => {
    expect(resolveNotesPanelDrag(520)).toEqual({ kind: "resize", width: 520 });
  });

  test("a slight undershoot snaps back to the minimum instead of closing", () => {
    // 240 is under 260 but well above the close threshold.
    expect(resolveNotesPanelDrag(240)).toEqual({ kind: "resize", width: MIN_NOTES_PANEL });
    expect(resolveNotesPanelDrag(CLOSE_NOTES_PANEL_BELOW + 1)).toEqual({
      kind: "resize",
      width: MIN_NOTES_PANEL,
    });
  });

  test("dragging it shut closes the column", () => {
    expect(resolveNotesPanelDrag(CLOSE_NOTES_PANEL_BELOW - 1)).toEqual({ kind: "close" });
    expect(resolveNotesPanelDrag(0)).toEqual({ kind: "close" });
  });

  test("never exceeds the maximum", () => {
    expect(resolveNotesPanelDrag(2000)).toEqual({ kind: "resize", width: MAX_NOTES_PANEL });
  });

  test("rounds to whole pixels", () => {
    expect(resolveNotesPanelDrag(412.6)).toEqual({ kind: "resize", width: 413 });
  });
});

describe("restoredNotesPanelWidth", () => {
  test("reopening after a close uses a usable width, never the collapsed one", () => {
    expect(restoredNotesPanelWidth(0)).toBe(MIN_NOTES_PANEL);
    expect(restoredNotesPanelWidth(20)).toBe(MIN_NOTES_PANEL);
    expect(restoredNotesPanelWidth(9999)).toBe(MAX_NOTES_PANEL);
    expect(restoredNotesPanelWidth(430.4)).toBe(430);
    expect(restoredNotesPanelWidth(DEFAULT_NOTES_PANEL)).toBe(DEFAULT_NOTES_PANEL);
  });
});
