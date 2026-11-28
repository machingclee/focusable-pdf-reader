import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { rememberPage, rememberRecent, type RecentDoc } from "../../prefs";

/**
 * The open document, as identity only: which file, its name, how long it is, and
 * whether it is currently being opened.
 *
 * The document itself — the parsed PDF and its pages — is **not** here. It is a
 * pdf.js object graph with workers and canvases behind it, none of it serialisable
 * and none of it something a reducer could copy. It stays with the code that
 * opened it, and components that need its pages read them through the viewer's
 * document session. What the store holds is what the chrome shows: the title, the
 * page count, the error line, the spinner.
 */
export type DocumentState = {
  /** The document's library path, or null for one opened from bytes. */
  path: string | null;
  /** The name to show for it, or null when nothing is open. */
  name: string | null;
  pageCount: number;
  busy: boolean;
  error: string | null;
  /** A PDF is being dragged over the window: the veil is up. */
  dropActive: boolean;
  /**
   * The documents already read, most recent first, with the page each was left on.
   *
   * Here rather than in a component because three places show it — the toolbar's
   * recents menu, the empty stage's list and the launch restore — and one place
   * writes it: an open, or a page turn. A page turn is folded in through the same
   * reducer, so the bookmark is the last page the document was read at.
   */
  recents: RecentDoc[];
};

const initialState: DocumentState = {
  path: null,
  name: null,
  pageCount: 0,
  busy: false,
  error: null,
  dropActive: false,
  recents: [],
};

const documentSlice = createSlice({
  name: "document",
  initialState,
  reducers: {
    documentOpened(
      state,
      action: PayloadAction<{ path: string | null; name: string; pageCount: number }>,
    ) {
      state.path = action.payload.path;
      state.name = action.payload.name;
      state.pageCount = action.payload.pageCount;
      state.error = null;
    },
    documentClosed(state) {
      state.path = null;
      state.name = null;
      state.pageCount = 0;
      // The path is what the notes column, the badges and the detached window
      // display. Clearing the pages and leaving the path would keep the old
      // document on screen.
      state.error = null;
    },
    busyChanged(state, action: PayloadAction<boolean>) {
      state.busy = action.payload;
    },
    errorReported(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
    dropVeilChanged(state, action: PayloadAction<boolean>) {
      state.dropActive = action.payload;
    },
    /** The reader's saved history, applied once at startup. */
    recentsRestored(state, action: PayloadAction<RecentDoc[]>) {
      state.recents = action.payload;
    },
    /** A document was opened: it becomes the first entry, at its page. */
    recentOpened(state, action: PayloadAction<{ name: string; path?: string; page: number }>) {
      state.recents = rememberRecent(state.recents, action.payload.name, action.payload.path, action.payload.page);
    },
    /** The reader turned to another page: that is where this document now sits. */
    pageRemembered(state, action: PayloadAction<{ name: string; path?: string; page: number }>) {
      state.recents = rememberPage(state.recents, action.payload.name, action.payload.path, action.payload.page);
    },
  },
});

export const {
  documentOpened,
  documentClosed,
  busyChanged,
  errorReported,
  dropVeilChanged,
  recentsRestored,
  recentOpened,
  pageRemembered,
} = documentSlice.actions;

export default documentSlice.reducer;

type WithDocument = { document: DocumentState };
export const selectDocument = (state: WithDocument) => state.document;
export const selectDocumentPath = (state: WithDocument) => state.document.path;
export const selectDocumentName = (state: WithDocument) => state.document.name;
export const selectPageCount = (state: WithDocument) => state.document.pageCount;
export const selectBusy = (state: WithDocument) => state.document.busy;
export const selectError = (state: WithDocument) => state.document.error;
export const selectDropActive = (state: WithDocument) => state.document.dropActive;
export const selectRecents = (state: WithDocument) => state.document.recents;
