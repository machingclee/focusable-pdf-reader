import { describe, expect, test } from "bun:test";
import {
  CLOSE_NOTES_PANEL_BELOW,
  DEFAULT_NOTES_PANEL,
  MIN_NOTES_PANEL,
  maxNotesPanelWidth,
  resolveNotesPanelDrag,
  restoredNotesPanelWidth,
} from "../src/notesPanel";

/** A workspace: the box the docked column floats over, in px. */
const WORKSPACE = 1400;

describe("maxNotesPanelWidth", () => {
  test("the ceiling is the workspace the column covers", () => {
    // The column is an overlay on the page, so it may cover the whole page area —
    // the old fixed 760 px stopped it long before that.
    expect(maxNotesPanelWidth(WORKSPACE)).toBe(WORKSPACE);
    expect(maxNotesPanelWidth(900)).toBe(900);
    expect(maxNotesPanelWidth(2600)).toBe(2600);
  });

  test("rounds to whole pixels, and never under the minimum", () => {
    expect(maxNotesPanelWidth(1000.4)).toBe(1000);
    // A viewer narrower than the column's own floor still has to give a usable
    // number, or the floor and the ceiling would cross.
    expect(maxNotesPanelWidth(120)).toBe(MIN_NOTES_PANEL);
  });

  test("an unmeasurable viewer falls back rather than reporting zero", () => {
    // The Notes tab hides the viewer, so its width cannot be measured; the width
    // must not collapse because of it.
    for (const width of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(maxNotesPanelWidth(width)).toBeGreaterThan(MIN_NOTES_PANEL);
    }
  });
});

describe("resolveNotesPanelDrag", () => {
  test("widening keeps the dragged width", () => {
    expect(resolveNotesPanelDrag(520, WORKSPACE)).toEqual({ kind: "resize", width: 520 });
  });

  test("a slight undershoot snaps back to the minimum instead of closing", () => {
    // 240 is under 260 but well above the close threshold.
    expect(resolveNotesPanelDrag(240, WORKSPACE)).toEqual({ kind: "resize", width: MIN_NOTES_PANEL });
    expect(resolveNotesPanelDrag(CLOSE_NOTES_PANEL_BELOW + 1, WORKSPACE)).toEqual({
      kind: "resize",
      width: MIN_NOTES_PANEL,
    });
  });

  test("dragging it shut closes the column", () => {
    expect(resolveNotesPanelDrag(CLOSE_NOTES_PANEL_BELOW - 1, WORKSPACE)).toEqual({ kind: "close" });
    expect(resolveNotesPanelDrag(0, WORKSPACE)).toEqual({ kind: "close" });
  });

  test("never wider than the workspace it covers", () => {
    // Dragged past the edge of the viewer: it stops at the edge, whatever the
    // window is, rather than at a constant.
    expect(resolveNotesPanelDrag(2000, WORKSPACE)).toEqual({ kind: "resize", width: WORKSPACE });
    expect(resolveNotesPanelDrag(2000, 2400)).toEqual({ kind: "resize", width: 2000 });
    expect(resolveNotesPanelDrag(2000, 900)).toEqual({ kind: "resize", width: 900 });
  });

  test("rounds to whole pixels", () => {
    expect(resolveNotesPanelDrag(412.6, WORKSPACE)).toEqual({ kind: "resize", width: 413 });
  });
});

describe("restoredNotesPanelWidth", () => {
  test("reopening after a close uses a usable width, never the collapsed one", () => {
    expect(restoredNotesPanelWidth(0, WORKSPACE)).toBe(MIN_NOTES_PANEL);
    expect(restoredNotesPanelWidth(20, WORKSPACE)).toBe(MIN_NOTES_PANEL);
    expect(restoredNotesPanelWidth(9999, WORKSPACE)).toBe(WORKSPACE);
    expect(restoredNotesPanelWidth(430.4, WORKSPACE)).toBe(430);
    expect(restoredNotesPanelWidth(DEFAULT_NOTES_PANEL, WORKSPACE)).toBe(DEFAULT_NOTES_PANEL);
  });
});
