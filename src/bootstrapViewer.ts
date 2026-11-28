/**
 * What a window's store starts at, before anything renders.
 *
 * Two things can only be known outside React: the reader's saved preferences
 * (`prefs.ts`, per webview) and what this window was opened for — the query
 * string, which for a viewer window names a document and possibly one passage in
 * it. Seeding them here, once, before the first render, is what lets the rest of
 * the app treat the store as the truth from the first frame: no effect has to
 * apply a default, and nothing can be written back over the saved values before
 * they have been read.
 */
import type { Store } from "@reduxjs/toolkit";
import { loadPrefs } from "./prefs";
import { parseViewerRequest } from "./viewerRequest";
import { recentsRestored } from "./store/slices/documentSlice";
import { viewerInitialized } from "./store/slices/viewerSlice";

export function seedViewerStore(store: Store): void {
  const prefs = loadPrefs();
  const request = parseViewerRequest();
  const isWindowOfItsOwn = request !== null;

  store.dispatch(recentsRestored(prefs.recents));
  store.dispatch(
    viewerInitialized({
      view: "pdf",
      // A window opened on one passage starts in single page mode with the rail
      // folded: the passage is the band on that one page, and the rail's job —
      // getting somewhere else — is the one thing that window is not for.
      pageLayout: isWindowOfItsOwn ? "single" : prefs.pageLayout,
      railOpen: !isWindowOfItsOwn,
      stripHeight: prefs.stripBase,
      stripBlur: prefs.stripBlur,
    }),
  );
}
