import { describe, expect, test } from "bun:test";
import {
  CLOSE_NOTES_PANEL_BELOW,
  DEFAULT_NOTES_PANEL,
  MIN_NOTES_PANEL,
  MIN_STAGE_WIDTH,
  maxNotesPanelWidth,
  resolveNotesPanelDrag,
  restoredNotesPanelWidth,
} from "../src/notesPanel";

/** The row the page and the docked column split between them, in px. */
const ROW = 1400;

describe("maxNotesPanelWidth", () => {
  test("the ceiling leaves the page its own minimum", () => {
    // Docked, the column takes width from the page instead of covering it: past
    // ROW - MIN_STAGE_WIDTH the page would be squeezed under the size it needs.
    expect(maxNotesPanelWidth(ROW)).toBe(ROW - MIN_STAGE_WIDTH);
    expect(maxNotesPanelWidth(900)).toBe(900 - MIN_STAGE_WIDTH);
    // A wide window is where the old fixed 760 px ceiling used to bite.
    expect(maxNotesPanelWidth(2600)).toBe(2600 - MIN_STAGE_WIDTH);
  });

  test("the page minimum is about one page at 100%", () => {
    // A 595 pt page plus the margins that let a reader see its edges: any less and
    // the column is widening over a document nobody could read.
    expect(MIN_STAGE_WIDTH).toBeGreaterThanOrEqual(440);
    expect(MIN_STAGE_WIDTH).toBeLessThanOrEqual(640);
  });

  test("rounds to whole pixels, and never under the minimum", () => {
    expect(maxNotesPanelWidth(1000.4)).toBe(1000 - MIN_STAGE_WIDTH);
    // A row narrower than both minimums still has to yield a usable number, or
    // the floor and the ceiling would cross and the column could not be dragged.
    expect(maxNotesPanelWidth(120)).toBe(MIN_NOTES_PANEL);
    expect(maxNotesPanelWidth(MIN_STAGE_WIDTH + 40)).toBe(MIN_NOTES_PANEL);
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
    expect(resolveNotesPanelDrag(520, ROW)).toEqual({ kind: "resize", width: 520 });
  });

  test("a slight undershoot snaps back to the minimum instead of closing", () => {
    // 240 is under 260 but well above the close threshold.
    expect(resolveNotesPanelDrag(240, ROW)).toEqual({ kind: "resize", width: MIN_NOTES_PANEL });
    expect(resolveNotesPanelDrag(CLOSE_NOTES_PANEL_BELOW + 1, ROW)).toEqual({
      kind: "resize",
      width: MIN_NOTES_PANEL,
    });
  });

  test("dragging it shut closes the column", () => {
    expect(resolveNotesPanelDrag(CLOSE_NOTES_PANEL_BELOW - 1, ROW)).toEqual({ kind: "close" });
    expect(resolveNotesPanelDrag(0, ROW)).toEqual({ kind: "close" });
  });

  test("never wider than the ceiling the page leaves it", () => {
    // Dragged past what the page can spare: it stops there, whatever the window
    // is, rather than at a constant.
    const ceiling = maxNotesPanelWidth(ROW);
    expect(resolveNotesPanelDrag(2000, ceiling)).toEqual({ kind: "resize", width: ceiling });
    expect(resolveNotesPanelDrag(2000, 2400)).toEqual({ kind: "resize", width: 2000 });
    expect(resolveNotesPanelDrag(2000, 900)).toEqual({ kind: "resize", width: 900 });
  });

  test("rounds to whole pixels", () => {
    expect(resolveNotesPanelDrag(412.6, ROW)).toEqual({ kind: "resize", width: 413 });
  });
});

describe("restoredNotesPanelWidth", () => {
  test("reopening after a close uses a usable width, never the collapsed one", () => {
    const ceiling = maxNotesPanelWidth(ROW);
    expect(restoredNotesPanelWidth(0, ceiling)).toBe(MIN_NOTES_PANEL);
    expect(restoredNotesPanelWidth(20, ceiling)).toBe(MIN_NOTES_PANEL);
    expect(restoredNotesPanelWidth(9999, ceiling)).toBe(ceiling);
    expect(restoredNotesPanelWidth(430.4, ceiling)).toBe(430);
    expect(restoredNotesPanelWidth(DEFAULT_NOTES_PANEL, ceiling)).toBe(DEFAULT_NOTES_PANEL);
  });

  test("a remembered width wider than this window narrows to fit", () => {
    // The remembered width comes from the backend and may have been set on a
    // larger screen; the page beside it still gets its minimum.
    const small = maxNotesPanelWidth(1000);
    expect(restoredNotesPanelWidth(700, small)).toBe(small);
    expect(small).toBe(1000 - MIN_STAGE_WIDTH);
  });
});
