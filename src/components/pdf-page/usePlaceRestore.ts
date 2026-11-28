/**
 * The reader's place: where a document opens, and where the app starts.
 *
 * Two halves of the same promise, and both are about *restoring* a place rather
 * than moving to one:
 *
 * - **On launch** — the last document that was read is opened again, once, on the
 *   first render after the recents are known. Through the library like any other
 *   open, so a recents entry holding a legacy path is upgraded before the viewer
 *   ever reads it. Only the desktop build does this: a browser tab opening a file
 *   from a remembered path would be a surprise, and it cannot anyway.
 * - **On opening a document** — the page it was last read at is put back, along
 *   with the strip a click asked to stand on. Both are *requests* written down
 *   before the pages exist (`pendingPageRestore`), and this is the pass that
 *   answers them once the page boxes are laid out. A strip restore moves the
 *   scroll and the band together, which is why it happens here and not in the
 *   open itself.
 *
 * The request is cleared as it is answered, so a later zoom or a re-render cannot
 * drag the reader back to it.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { LoadedPdf } from "../../pdf";
import type { RecentDoc } from "../../prefs";
import { isTauri } from "../../windowBridge";

/** How long a jump owns the page readout before the scroll listener takes over. */
const JUMP_OWNED_MS = 400;

export type PlaceRestoreOptions = {
  pdf: LoadedPdf | null;
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** The page a jump is waiting for, from this restore or from any other. */
  jumpingToPage: { current: number | null };
  /** The page an open asked for, and the strip it asked to stand on. */
  pendingPage: { current: number | null };
  pendingStrip: { current: { fracY: number } | null };
  /** Set when the open is still measuring (Fit): the restore waits for the zoom. */
  skipUntilZoom: { current: boolean };
  /** Re-run the restore when the viewer has settled at its zoom. */
  restoreTick: number;
  zoom: number;
  /** Scroll a page's top into view. */
  scrollToPage: (node: HTMLElement) => void;
  /** Stand the band on a fraction of a page, then scroll it there. */
  alignStripUnderBand: (node: HTMLElement, fracY: number) => void;
  /** The recents, for the document to reopen on launch. */
  recents: RecentDoc[];
  /** Open a document the way the recents list does. */
  openRecent: (path: string, name?: string) => Promise<unknown> | void;
};

export function usePlaceRestore({
  pdf,
  scrollerRef,
  jumpingToPage,
  pendingPage,
  pendingStrip,
  skipUntilZoom,
  restoreTick,
  zoom,
  scrollToPage,
  alignStripUnderBand,
  recents,
  openRecent,
}: PlaceRestoreOptions): void {
  const lastOpened = useRef(false);

  // Start where the reader left off — once.
  useEffect(() => {
    if (lastOpened.current) return;
    lastOpened.current = true;
    if (!isTauri()) return;
    const last = recents.find((doc) => doc.path);
    if (!last?.path) return;
    void openRecent(last.path, last.name);
  }, [openRecent, recents]);

  // Answer the open's request for a page, once its boxes exist.
  useLayoutEffect(() => {
    const target = pendingPage.current;
    if (target == null || !pdf || skipUntilZoom.current) return;
    const node = scrollerRef.current?.querySelector<HTMLElement>(`[data-page="${target}"]`);
    if (!node) return;
    const strip = pendingStrip.current;
    pendingPage.current = null;
    pendingStrip.current = null;
    jumpingToPage.current = target;
    if (strip) alignStripUnderBand(node, strip.fracY);
    else scrollToPage(node);
    window.setTimeout(() => {
      if (jumpingToPage.current === target) jumpingToPage.current = null;
    }, JUMP_OWNED_MS);
  }, [
    alignStripUnderBand,
    jumpingToPage,
    pdf,
    pendingPage,
    pendingStrip,
    restoreTick,
    scrollerRef,
    scrollToPage,
    skipUntilZoom,
    zoom,
  ]);
}
