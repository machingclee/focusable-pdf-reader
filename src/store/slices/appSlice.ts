import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/**
 * Credentials for the local backend.
 *
 * Kept in memory only on purpose. The packaged app generates a fresh token on
 * every launch (`src-tauri/src/lib.rs`) and the sidecar listens on an
 * OS-chosen port, so persisting either would be stale — and localStorage is
 * the wrong place for a secret. `baseApi` fills this in the first time it
 * resolves the target, so components can read it with `useAppSelector`.
 */
export type BackendCredentials = {
  baseUrl: string;
  token: string | null;
};

/**
 * One resting place in the open PDF, and the place it was reached from.
 *
 * `current` is the scroller's vertical offset in CSS pixels. `prev` is the
 * `current` of the mark before it (or the same value, for the first mark of a
 * document, which is only there so the next move has something to point back at).
 * The back button walks to `prev`; the forward button walks to a later `current`.
 */
export type PdfScrollMark = {
  prev: number;
  current: number;
};

/** How many resting positions a document keeps. Older marks fall off the front. */
export const PDF_SCROLL_HISTORY_LIMIT = 20;

interface AppState {
  backendBaseUrl: string | null;
  backendToken: string | null;
  /**
   * Resting vertical offsets for the open PDF, oldest first.
   * Session-only: a reload, and opening another document, start this over.
   * Offsets are CSS pixels of that document at the zoom they were taken, so
   * they are cleared with the document rather than kept beside the credentials.
   */
  pdfScrollPositions: PdfScrollMark[];
  /**
   * Which mark the viewer is standing on. `-1` when the list is empty.
   * Back and forward move this; a new resting offset appends (and drops any
   * marks that were ahead of here, the way a browser drops its forward stack).
   */
  pdfScrollIndex: number;
}

const initialState: AppState = {
  backendBaseUrl: null,
  backendToken: null,
  pdfScrollPositions: [],
  pdfScrollIndex: -1,
};

function scrollOffset(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

export const appSlice = createSlice({
  name: "app",
  initialState,
  reducers: {
    setBackend: (state, action: PayloadAction<BackendCredentials>) => {
      state.backendBaseUrl = action.payload.baseUrl;
      state.backendToken = action.payload.token;
    },
    clearBackend: (state) => {
      state.backendBaseUrl = null;
      state.backendToken = null;
    },
    /**
     * Remember a resting vertical offset.
     *
     * The new mark's `prev` is the latest `current` (the place we were standing),
     * and its `current` is the offset passed in. The same offset twice is not a
     * new place. A mark recorded after stepping backward replaces the marks that
     * were ahead of the step, and the list never grows past
     * {@link PDF_SCROLL_HISTORY_LIMIT}.
     */
    recordPdfScrollPosition: (state, action: PayloadAction<number>) => {
      const current = scrollOffset(action.payload);
      if (current === null) return;

      const index = state.pdfScrollIndex;
      const active = index >= 0 ? state.pdfScrollPositions[index] : undefined;
      if (active && active.current === current) return;

      if (index >= 0 && index < state.pdfScrollPositions.length - 1) {
        state.pdfScrollPositions.splice(index + 1);
      }

      const prev = state.pdfScrollPositions.at(-1)?.current ?? current;
      state.pdfScrollPositions.push({ prev, current });
      const overflow = state.pdfScrollPositions.length - PDF_SCROLL_HISTORY_LIMIT;
      if (overflow > 0) state.pdfScrollPositions.splice(0, overflow);
      state.pdfScrollIndex = state.pdfScrollPositions.length - 1;
    },
    /** Step onto the previous mark. The view then scrolls to that mark's `current`. */
    goToPreviousPdfScroll: (state) => {
      if (state.pdfScrollIndex > 0) state.pdfScrollIndex -= 1;
    },
    /** Step onto the next mark. The view then scrolls to that mark's `current`. */
    goToNextPdfScroll: (state) => {
      if (state.pdfScrollIndex >= 0 && state.pdfScrollIndex < state.pdfScrollPositions.length - 1) {
        state.pdfScrollIndex += 1;
      }
    },
    /**
     * The scroller could not take the offset we just stepped to (the document
     * is shorter than the stored place). Rewrite that mark so the clamped
     * offset is the place we are standing, without appending a new one.
     */
    settleActivePdfScroll: (state, action: PayloadAction<number>) => {
      const current = scrollOffset(action.payload);
      const index = state.pdfScrollIndex;
      const mark = index >= 0 ? state.pdfScrollPositions[index] : undefined;
      if (current === null || !mark || mark.current === current) return;
      mark.current = current;
      const next = state.pdfScrollPositions[index + 1];
      if (next) next.prev = current;
    },
    clearPdfScrollPositions: (state) => {
      state.pdfScrollPositions = [];
      state.pdfScrollIndex = -1;
    },
  },
});

export const {
  setBackend,
  clearBackend,
  recordPdfScrollPosition,
  goToPreviousPdfScroll,
  goToNextPdfScroll,
  settleActivePdfScroll,
  clearPdfScrollPositions,
} = appSlice.actions;

/** The vertical offset the back/forward step just landed on, if the list has one. */
export function activePdfScrollOffset(state: AppState): number | null {
  const mark = state.pdfScrollPositions[state.pdfScrollIndex];
  return mark ? mark.current : null;
}

export default appSlice;
