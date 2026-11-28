/**
 * The reader's preferences: the strip's size and blur, the page layout, and the
 * documents they have read — written as they change, and again when the window
 * goes away.
 *
 * Two writes, because the two moments are different:
 *
 * - **as they change** — the values as this render has them, which is what makes
 *   the next launch start where this one left off;
 * - **on the way out** — `pagehide` and `beforeunload`, which fire outside a
 *   render, so the values are read from the app's refs. The page the reader is on
 *   is folded in here and not in the first write: a page is remembered per
 *   document, and a scroll is not a preference worth writing on every page turn.
 *
 * A viewer window does not record the page layout: it opens in the layout it was
 * asked for, and that is not a change the app made.
 *
 * The recents list is also what remembers the page: `rememberPage` replaces the
 * entry for this document, so a bookmark is the last page it was read at.
 */
import { useEffect } from "react";
import { pageLayoutToSave, savePrefs, type RecentDoc } from "./prefs";
import type { PageLayout } from "./pageLayout";

export type ViewerPrefsState = {
  stripBase: number;
  stripBlur: number;
  pageLayout: PageLayout;
  recents: RecentDoc[];
};

export type ViewerPrefsOptions = {
  /** The values as this render has them: written whenever one of them changes. */
  prefs: ViewerPrefsState;
  /** Their newest values, read outside a render for the way out. */
  latest: () => ViewerPrefsState | null;
  /** A viewer window does not record the layout it was opened in. */
  isWindowOfItsOwn: boolean;
};

export function useViewerPrefs({ prefs, latest, isWindowOfItsOwn }: ViewerPrefsOptions): void {
  const { stripBase, stripBlur, pageLayout, recents } = prefs;

  useEffect(() => {
    savePrefs({
      stripBase,
      stripBlur,
      pageLayout: pageLayoutToSave(pageLayout, isWindowOfItsOwn),
      recents,
    });
  }, [isWindowOfItsOwn, pageLayout, recents, stripBase, stripBlur]);

  useEffect(() => {
    const persistOnTheWayOut = () => {
      const state = latest();
      if (!state) return;
      savePrefs({
        stripBase: state.stripBase,
        stripBlur: state.stripBlur,
        pageLayout: pageLayoutToSave(state.pageLayout, isWindowOfItsOwn),
        recents: state.recents,
      });
    };
    window.addEventListener("pagehide", persistOnTheWayOut);
    window.addEventListener("beforeunload", persistOnTheWayOut);
    return () => {
      window.removeEventListener("pagehide", persistOnTheWayOut);
      window.removeEventListener("beforeunload", persistOnTheWayOut);
    };
  }, [isWindowOfItsOwn, latest]);
}
