import { describe, expect, test } from "bun:test";
import { apiErrorMessage } from "../src/store/api/baseApi";
import appSlice, {
  PDF_SCROLL_HISTORY_LIMIT,
  clearBackend,
  clearPdfScrollPositions,
  goToNextPdfScroll,
  goToPreviousPdfScroll,
  recordPdfScrollPosition,
  setBackend,
  settleActivePdfScroll,
} from "../src/store/slices/appSlice";

const emptyScroll = { pdfScrollPositions: [], pdfScrollIndex: -1 };

describe("appSlice", () => {
  test("starts without backend credentials", () => {
    expect(appSlice.reducer(undefined, { type: "@@init" })).toEqual({
      backendBaseUrl: null,
      backendToken: null,
      ...emptyScroll,
    });
  });

  test("keeps the resolved address and token, and can clear them", () => {
    const withBackend = appSlice.reducer(
      undefined,
      setBackend({ baseUrl: "http://127.0.0.1:4317", token: "abc123" }),
    );
    expect(withBackend).toEqual({
      backendBaseUrl: "http://127.0.0.1:4317",
      backendToken: "abc123",
      ...emptyScroll,
    });

    expect(appSlice.reducer(withBackend, clearBackend())).toEqual({
      backendBaseUrl: null,
      backendToken: null,
      ...emptyScroll,
    });
  });

  test("accepts a backend without a token (dev mode)", () => {
    const withBackend = appSlice.reducer(undefined, setBackend({ baseUrl: "http://127.0.0.1:4317", token: null }));
    expect(withBackend.backendToken).toBeNull();
  });

  test("appends a scroll mark whose prev is the previous current", () => {
    const seeded = appSlice.reducer(undefined, recordPdfScrollPosition(0));
    expect(seeded.pdfScrollPositions).toEqual([{ prev: 0, current: 0 }]);
    expect(seeded.pdfScrollIndex).toBe(0);

    const moved = appSlice.reducer(seeded, recordPdfScrollPosition(480));
    expect(moved.pdfScrollPositions).toEqual([
      { prev: 0, current: 0 },
      { prev: 0, current: 480 },
    ]);
    expect(moved.pdfScrollIndex).toBe(1);

    const again = appSlice.reducer(moved, recordPdfScrollPosition(1200.4));
    expect(again.pdfScrollPositions[2]).toEqual({ prev: 480, current: 1200 });
    expect(again.pdfScrollIndex).toBe(2);
  });

  test("does not record the same resting offset, or a value that is not a number", () => {
    const seeded = appSlice.reducer(undefined, recordPdfScrollPosition(80));
    const same = appSlice.reducer(seeded, recordPdfScrollPosition(80.2));
    expect(same.pdfScrollPositions).toHaveLength(1);

    const nan = appSlice.reducer(same, recordPdfScrollPosition(Number.NaN));
    expect(nan).toBe(same);
  });

  test("walks backward and forward across the marks", () => {
    let state = appSlice.reducer(undefined, recordPdfScrollPosition(0));
    state = appSlice.reducer(state, recordPdfScrollPosition(100));
    state = appSlice.reducer(state, recordPdfScrollPosition(250));

    state = appSlice.reducer(state, goToPreviousPdfScroll());
    expect(state.pdfScrollIndex).toBe(1);
    expect(state.pdfScrollPositions[state.pdfScrollIndex]?.current).toBe(100);

    state = appSlice.reducer(state, goToNextPdfScroll());
    expect(state.pdfScrollIndex).toBe(2);
    expect(state.pdfScrollPositions[state.pdfScrollIndex]?.current).toBe(250);

    const stuckBack = appSlice.reducer(
      appSlice.reducer(state, goToPreviousPdfScroll()),
      goToPreviousPdfScroll(),
    );
    expect(appSlice.reducer(stuckBack, goToPreviousPdfScroll()).pdfScrollIndex).toBe(0);
    expect(appSlice.reducer(state, goToNextPdfScroll()).pdfScrollIndex).toBe(2);
  });

  test("a new offset after stepping back drops the marks ahead of it", () => {
    let state = appSlice.reducer(undefined, recordPdfScrollPosition(0));
    state = appSlice.reducer(state, recordPdfScrollPosition(100));
    state = appSlice.reducer(state, recordPdfScrollPosition(200));
    state = appSlice.reducer(state, recordPdfScrollPosition(300));
    state = appSlice.reducer(state, goToPreviousPdfScroll());
    state = appSlice.reducer(state, goToPreviousPdfScroll());
    state = appSlice.reducer(state, recordPdfScrollPosition(150));

    expect(state.pdfScrollPositions.map((mark) => mark.current)).toEqual([0, 100, 150]);
    expect(state.pdfScrollPositions[2]).toEqual({ prev: 100, current: 150 });
    expect(state.pdfScrollIndex).toBe(2);
  });

  test("keeps at most 100 marks, dropping the oldest", () => {
    let state = appSlice.reducer(undefined, { type: "@@init" });
    for (let i = 0; i <= PDF_SCROLL_HISTORY_LIMIT + 5; i += 1) {
      state = appSlice.reducer(state, recordPdfScrollPosition(i * 10));
    }
    const newest = (PDF_SCROLL_HISTORY_LIMIT + 5) * 10;
    expect(state.pdfScrollPositions).toHaveLength(PDF_SCROLL_HISTORY_LIMIT);
    expect(state.pdfScrollPositions[0]?.current).toBe(60);
    expect(state.pdfScrollPositions.at(-1)).toEqual({ prev: newest - 10, current: newest });
    expect(state.pdfScrollIndex).toBe(PDF_SCROLL_HISTORY_LIMIT - 1);
  });

  test("settles the active mark when the scroller clamps, and can clear the list", () => {
    let state = appSlice.reducer(undefined, recordPdfScrollPosition(0));
    state = appSlice.reducer(state, recordPdfScrollPosition(4000));
    state = appSlice.reducer(state, goToPreviousPdfScroll());
    state = appSlice.reducer(state, settleActivePdfScroll(12));
    expect(state.pdfScrollPositions[0]).toEqual({ prev: 0, current: 12 });
    expect(state.pdfScrollPositions[1]?.prev).toBe(12);
    expect(state.pdfScrollPositions).toHaveLength(2);

    const cleared = appSlice.reducer(state, clearPdfScrollPositions());
    expect(cleared.pdfScrollPositions).toEqual([]);
    expect(cleared.pdfScrollIndex).toBe(-1);
  });

  test("credential updates leave the scroll history alone", () => {
    let state = appSlice.reducer(undefined, recordPdfScrollPosition(40));
    state = appSlice.reducer(state, setBackend({ baseUrl: "http://127.0.0.1:4317", token: "abc" }));
    state = appSlice.reducer(state, clearBackend());
    expect(state.pdfScrollPositions).toEqual([{ prev: 40, current: 40 }]);
    expect(state.backendBaseUrl).toBeNull();
  });
});

describe("apiErrorMessage", () => {
  test("reads the backend's { error } envelope", () => {
    expect(apiErrorMessage({ status: 400, data: { error: "Validation failed", details: [] } })).toBe(
      "Validation failed",
    );
  });

  test("passes through resolution and network failures", () => {
    expect(apiErrorMessage({ status: "CUSTOM_ERROR", error: "the backend did not report a port" })).toBe(
      "the backend did not report a port",
    );
    expect(apiErrorMessage({ status: "FETCH_ERROR", error: "TypeError: Failed to fetch" })).toBe(
      "The backend is not reachable",
    );
  });

  test("falls back to the status code or the thrown message", () => {
    expect(apiErrorMessage({ status: 500, data: null })).toBe("Request failed (500)");
    expect(apiErrorMessage({ name: "Error", message: "boom" })).toBe("boom");
    expect(apiErrorMessage(undefined)).toBeNull();
  });
});
