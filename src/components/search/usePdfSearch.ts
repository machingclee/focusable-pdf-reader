/**
 * Find in document: the query, the hits it makes, and moving between them.
 *
 * Four things have to agree, which is why they are one hook: the box's draft (it
 * debounces, and lives in `SearchBar`), the committed query, the hits that query
 * makes on the open document, and which hit the reader is on. The hits are found
 * whenever the query or the document changes; the hit the reader is on is put in
 * view whenever it is chosen, and again when the page geometry changes under it
 * (a zoom, a layout toggle) because its marker has moved by then.
 *
 * Opening is a request to type, so the box is focused and its text selected.
 * Closing drops the query as well as the box: a find that is reopened is a new
 * find, not a resumed one.
 */
import { useCallback, useEffect, useLayoutEffect, type RefObject } from "react";
import { findHits, type SearchHit } from "../../search";
import type { LoadedPdf } from "../../pdf";
import { spreadStart, type PageLayout } from "../../pageLayout";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  activeHitChanged,
  searchCleared,
  searchClosed,
  searchHitsFound,
  searchOpened,
  searchQueryCommitted,
  searchReset,
  selectActiveHit,
  selectSearchHits,
  selectSearchOpen,
  selectSearchQuery,
} from "../../store/slices/searchSlice";

export type PdfSearchOptions = {
  pdf: LoadedPdf | null;
  /** The page area, where the current hit's marker is looked for. */
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** The find box, so opening it can focus it. */
  inputRef: RefObject<HTMLInputElement | null>;
  /** The page layout in force when a hit is chosen. */
  layoutRef: RefObject<PageLayout>;
  /**
   * The page a jump is waiting for, from either side: the viewer clears this once
   * the page has landed.
   */
  jumpingToPage: { current: number | null };
  /**
   * Name the page the spread starts on, without scrolling: choosing a hit has
   * always named the page and let the marker's own scroll put it in view.
   */
  showSpreadStart: (index: number) => void;
  /** Show a page — used only when the chosen hit's marker is not drawn yet. */
  showPage: (index: number) => void;
  /** Put the scroller where a marker can be seen. */
  scrollTo: (node: HTMLElement, block: "start" | "center") => void;
  /**
   * The zoom, as a dependency rather than a value: a hit's marker moves when the
   * pages are rescaled, so the current one has to be put back in view.
   */
  zoom: number;
};

export type PdfSearch = {
  /** The find bar is up. */
  open: boolean;
  /** The query the hits below were found for. */
  query: string;
  hits: SearchHit[];
  /** The hit the reader is on, or -1. */
  activeHit: number;
  openSearch: () => void;
  closeSearch: () => void;
  /** Step to the next (+1) or previous (-1) hit, wrapping. */
  stepHit: (delta: number) => void;
  /** Commit a query from the box. */
  commitQuery: (query: string) => void;
  /** The query was answered by nothing, or the document changed under it. */
  clearHits: () => void;
  /** The document is closed: no query, no hits, box shut. */
  reset: () => void;
};

export function usePdfSearch({
  pdf,
  scrollerRef,
  inputRef,
  layoutRef,
  jumpingToPage,
  showSpreadStart,
  showPage,
  scrollTo,
  zoom,
}: PdfSearchOptions): PdfSearch {
  // The box, its query, its hits and the hit the reader is on are the search
  // slice's: the pages paint the hits, so the state cannot live inside the bar.
  const dispatch = useAppDispatch();
  const open = useAppSelector(selectSearchOpen);
  const query = useAppSelector(selectSearchQuery);
  const hits = useAppSelector(selectSearchHits);
  const activeHit = useAppSelector(selectActiveHit);

  const goToHit = useCallback(
    (index: number, list: SearchHit[]) => {
      const hit = list[index];
      if (!hit) return;
      // A spread shows its first page, so that is the page the jump names.
      const shown = spreadStart(hit.pageIndex, layoutRef.current);
      jumpingToPage.current = shown;
      showSpreadStart(shown);
      dispatch(activeHitChanged(index));
    },
    [dispatch, jumpingToPage, layoutRef, showSpreadStart],
  );

  const openSearch = useCallback(() => {
    dispatch(searchOpened());
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [dispatch, inputRef]);

  const closeSearch = useCallback(() => {
    dispatch(searchClosed());
  }, [dispatch]);

  const clearHits = useCallback(() => {
    dispatch(searchCleared());
  }, [dispatch]);

  const reset = useCallback(() => {
    dispatch(searchReset());
  }, [dispatch]);

  const stepHit = useCallback(
    (delta: number) => {
      if (hits.length === 0) return;
      const from = activeHit < 0 ? (delta > 0 ? -1 : 0) : activeHit;
      const next = (from + delta + hits.length) % hits.length;
      dispatch(activeHitChanged(next));
      goToHit(next, hits);
    },
    [activeHit, dispatch, goToHit, hits],
  );

  const commitQuery = useCallback(
    (next: string) => {
      dispatch(searchQueryCommitted(next));
    },
    [dispatch],
  );

  // Every keystroke that settles re-searches the whole document, so the first hit
  // is chosen for the reader as soon as there is one.
  useEffect(() => {
    const pages = pdf?.pages.map((page) => page.text) ?? [];
    const nextHits = findHits(pages, query);
    dispatch(searchHitsFound(nextHits));
    if (!open || !query.trim() || nextHits.length === 0) {
      dispatch(activeHitChanged(-1));
      return;
    }
    dispatch(activeHitChanged(0));
    goToHit(0, nextHits);
  }, [dispatch, goToHit, open, pdf, query]);

  // Put the current hit in view. Its marker may not be drawn yet — its page can
  // still be off the scroller's rendered range — in which case the page is shown
  // first and this runs again once the marker exists.
  useLayoutEffect(() => {
    if (activeHit < 0) return;
    const scroller = scrollerRef.current;
    const marker = scroller?.querySelector<HTMLElement>(`[data-hit="${activeHit}"]`);
    if (marker) {
      scrollTo(marker, "center");
      window.setTimeout(() => {
        const hit = hits[activeHit];
        if (hit && jumpingToPage.current === hit.pageIndex) jumpingToPage.current = null;
      }, 400);
      return;
    }
    const hit = hits[activeHit];
    if (hit) showPage(hit.pageIndex);
  }, [activeHit, hits, jumpingToPage, scrollTo, scrollerRef, showPage, zoom]);

  return {
    open,
    query,
    hits,
    activeHit,
    openSearch,
    closeSearch,
    stepHit,
    commitQuery,
    clearHits,
    reset,
  };
}
