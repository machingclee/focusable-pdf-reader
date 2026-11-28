import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { SearchHit } from "../../search";

/**
 * Find in document: the box, its query, the hits it found, and which one the
 * reader is on.
 *
 * In the store because the answers are drawn in two places that are not each
 * other's parent: the find bar over the stage, and the highlight markers painted
 * on each page. A page needs to know the hit index it is showing, which is why
 * "which hit" cannot live inside the bar.
 *
 * The hits themselves are stored, not derived, so a page does not have to search
 * the document again to know what to paint; `usePdfSearch` is what keeps them
 * current with the query and the open document.
 */
export type SearchState = {
  open: boolean;
  query: string;
  hits: SearchHit[];
  /** The hit the reader is on, or -1. */
  activeHit: number;
};

const initialState: SearchState = {
  open: false,
  query: "",
  hits: [],
  activeHit: -1,
};

const searchSlice = createSlice({
  name: "search",
  initialState,
  reducers: {
    searchOpened(state) {
      state.open = true;
    },
    searchClosed(state) {
      // A find that is reopened is a new find, not a resumed one.
      state.open = false;
      state.query = "";
      state.hits = [];
      state.activeHit = -1;
    },
    searchQueryCommitted(state, action: PayloadAction<string>) {
      state.query = action.payload;
    },
    searchHitsFound(state, action: PayloadAction<SearchHit[]>) {
      state.hits = action.payload;
    },
    activeHitChanged(state, action: PayloadAction<number>) {
      state.activeHit = action.payload;
    },
    /** The query was answered by nothing, or the document changed under it. */
    searchCleared(state) {
      state.hits = [];
      state.activeHit = -1;
    },
    /**
     * A document was opened or closed: its hits are not the next one's, and the
     * query that made them belongs to a page nobody is looking at any more.
     */
    searchReset(state) {
      state.open = false;
      state.query = "";
      state.hits = [];
      state.activeHit = -1;
    },
  },
});

export const {
  searchOpened,
  searchClosed,
  searchQueryCommitted,
  searchHitsFound,
  activeHitChanged,
  searchCleared,
  searchReset,
} = searchSlice.actions;

export default searchSlice.reducer;

type WithSearch = { search: SearchState };
export const selectSearch = (state: WithSearch) => state.search;
export const selectSearchOpen = (state: WithSearch) => state.search.open;
export const selectSearchQuery = (state: WithSearch) => state.search.query;
export const selectSearchHits = (state: WithSearch) => state.search.hits;
export const selectActiveHit = (state: WithSearch) => state.search.activeHit;
