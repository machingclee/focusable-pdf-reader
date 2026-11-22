import { describe, expect, test } from "bun:test";
import {
  CLOSE_EVENT_LOG_PANEL_BELOW,
  DEFAULT_EVENT_LOG_PANEL,
  EVENT_LOG_PANEL_WIDTH_KEY,
  MIN_EVENT_LOG_PANEL,
  maxEventLogPanelWidth,
  resolveEventLogPanelDrag,
  restoredEventLogPanelWidth,
} from "../src/eventLogPanel";
import { MIN_STAGE_WIDTH } from "../src/dockedColumn";

/** The row the page and the docked column split between them, in px. */
const ROW = 1400;

describe("the event log column's numbers", () => {
  test("it starts wider than the notes column, because its rows are JSON", () => {
    expect(DEFAULT_EVENT_LOG_PANEL).toBeGreaterThanOrEqual(400);
    expect(DEFAULT_EVENT_LOG_PANEL).toBeGreaterThan(MIN_EVENT_LOG_PANEL);
    // Narrower than this and an event type plus its status badge stop fitting on
    // one line, which is the one thing a row has to show.
    expect(MIN_EVENT_LOG_PANEL).toBeGreaterThanOrEqual(280);
  });

  test("its width is remembered under a key of its own", () => {
    // Dotted like the notes column's, so the one map can hold both without either
    // overwriting the other.
    expect(EVENT_LOG_PANEL_WIDTH_KEY).toBe("event_log.width");
  });
});

describe("maxEventLogPanelWidth", () => {
  test("the page keeps its minimum however wide the log gets", () => {
    expect(maxEventLogPanelWidth(ROW)).toBe(ROW - MIN_STAGE_WIDTH);
    // A row too narrow for both still yields a usable number, or the floor and the
    // ceiling would cross and the column could not be dragged at all.
    expect(maxEventLogPanelWidth(120)).toBe(MIN_EVENT_LOG_PANEL);
  });

  test("an unmeasurable viewer falls back rather than reporting zero", () => {
    for (const width of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(maxEventLogPanelWidth(width)).toBeGreaterThan(MIN_EVENT_LOG_PANEL);
    }
  });
});

describe("resolveEventLogPanelDrag", () => {
  test("widening keeps the dragged width, rounded", () => {
    expect(resolveEventLogPanelDrag(520, ROW)).toEqual({ kind: "resize", width: 520 });
    expect(resolveEventLogPanelDrag(512.6, ROW)).toEqual({ kind: "resize", width: 513 });
  });

  test("a slight undershoot snaps back to the minimum instead of closing", () => {
    expect(resolveEventLogPanelDrag(MIN_EVENT_LOG_PANEL - 20, ROW)).toEqual({
      kind: "resize",
      width: MIN_EVENT_LOG_PANEL,
    });
  });

  test("dragging it shut closes the column", () => {
    expect(resolveEventLogPanelDrag(CLOSE_EVENT_LOG_PANEL_BELOW - 1, ROW)).toEqual({ kind: "close" });
    expect(resolveEventLogPanelDrag(0, ROW)).toEqual({ kind: "close" });
  });

  test("never wider than the ceiling the page leaves it", () => {
    const ceiling = maxEventLogPanelWidth(ROW);
    expect(resolveEventLogPanelDrag(2000, ceiling)).toEqual({ kind: "resize", width: ceiling });
  });
});

describe("restoredEventLogPanelWidth", () => {
  test("reopening after a close uses a usable width, never the collapsed one", () => {
    const ceiling = maxEventLogPanelWidth(ROW);
    expect(restoredEventLogPanelWidth(0, ceiling)).toBe(MIN_EVENT_LOG_PANEL);
    expect(restoredEventLogPanelWidth(9999, ceiling)).toBe(ceiling);
    expect(restoredEventLogPanelWidth(DEFAULT_EVENT_LOG_PANEL, ceiling)).toBe(DEFAULT_EVENT_LOG_PANEL);
  });

  test("a remembered width from a larger window narrows to fit", () => {
    const small = maxEventLogPanelWidth(1000);
    expect(restoredEventLogPanelWidth(700, small)).toBe(small);
  });
});
