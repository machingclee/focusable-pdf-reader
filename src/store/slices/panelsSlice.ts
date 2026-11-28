import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { DEFAULT_NOTES_PANEL } from "../../notesPanel";
import { DEFAULT_EVENT_LOG_PANEL } from "../../eventLogPanel";

/**
 * The columns docked beside the page, and the receipts that appear over it.
 *
 * A column's open state and width are read by three different things — the column
 * itself, the toolbar button that toggles it, and the page area that gives up the
 * width — which is exactly the shape of state that a component's own `useState`
 * makes awkward: it has to be threaded through every level between them. In the
 * store, each of those reads the one field it needs.
 *
 * The widths are the *remembered* values. The backend is the durable copy
 * (`useDockedColumnWidth` writes it), and this is the live one a drag moves.
 */
export type PanelsState = {
  notesOpen: boolean;
  notesWidth: number;
  /** The column lives in its own window: the inline one is not drawn. */
  notesDetached: boolean;
  /** A strip a note badge asked the column to show. */
  revealStripId: number | null;
  /** A strip that was just saved: its card should take the caret. */
  pendingEditId: number | null;
  eventLogOpen: boolean;
  eventLogWidth: number;
  /** A confirmation that clears itself, e.g. after a save. */
  toast: string | null;
};

const initialState: PanelsState = {
  notesOpen: false,
  notesWidth: DEFAULT_NOTES_PANEL,
  notesDetached: false,
  revealStripId: null,
  pendingEditId: null,
  eventLogOpen: false,
  eventLogWidth: DEFAULT_EVENT_LOG_PANEL,
  toast: null,
};

const panelsSlice = createSlice({
  name: "panels",
  initialState,
  reducers: {
    notesPanelToggled(state) {
      state.notesOpen = !state.notesOpen;
    },
    notesPanelOpened(state, action: PayloadAction<boolean>) {
      state.notesOpen = action.payload;
    },
    notesPanelWidthChanged(state, action: PayloadAction<number>) {
      state.notesWidth = Math.max(0, Math.round(action.payload));
    },
    notesDetachedChanged(state, action: PayloadAction<boolean>) {
      state.notesDetached = action.payload;
      // Popped out, the inline column is not drawn, so it is not open either.
      if (action.payload) state.notesOpen = false;
    },
    stripRevealed(state, action: PayloadAction<number | null>) {
      state.revealStripId = action.payload;
    },
    pendingEditChanged(state, action: PayloadAction<number | null>) {
      state.pendingEditId = action.payload;
    },
    eventLogToggled(state) {
      state.eventLogOpen = !state.eventLogOpen;
    },
    eventLogOpened(state, action: PayloadAction<boolean>) {
      state.eventLogOpen = action.payload;
    },
    eventLogWidthChanged(state, action: PayloadAction<number>) {
      state.eventLogWidth = Math.max(0, Math.round(action.payload));
    },
    toastShown(state, action: PayloadAction<string | null>) {
      state.toast = action.payload;
    },
  },
});

export const {
  notesPanelToggled,
  notesPanelOpened,
  notesPanelWidthChanged,
  notesDetachedChanged,
  stripRevealed,
  pendingEditChanged,
  eventLogToggled,
  eventLogOpened,
  eventLogWidthChanged,
  toastShown,
} = panelsSlice.actions;

export default panelsSlice.reducer;

type WithPanels = { panels: PanelsState };
export const selectPanels = (state: WithPanels) => state.panels;
export const selectNotesOpen = (state: WithPanels) => state.panels.notesOpen;
export const selectNotesWidth = (state: WithPanels) => state.panels.notesWidth;
export const selectNotesDetached = (state: WithPanels) => state.panels.notesDetached;
export const selectRevealStripId = (state: WithPanels) => state.panels.revealStripId;
export const selectPendingEditId = (state: WithPanels) => state.panels.pendingEditId;
export const selectEventLogOpen = (state: WithPanels) => state.panels.eventLogOpen;
export const selectEventLogWidth = (state: WithPanels) => state.panels.eventLogWidth;
export const selectToast = (state: WithPanels) => state.panels.toast;
