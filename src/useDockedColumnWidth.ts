/**
 * A docked column's width: remembered, clamped, and dragged by its own edge.
 *
 * Both of the viewer's side columns — the notes of the open PDF, and the event
 * log — obey the same rules, so they keep their width the same way: the number is
 * remembered in the backend (not the webview's storage) so it follows the profile;
 * it is applied once, so a later invalidation cannot fight a drag; it is capped
 * against the row it shares with the page whenever the viewer changes size; and a
 * drag on the column's seam settles at a usable width or closes the column.
 *
 * What is specific to a column is only its own numbers, which the caller passes
 * (`notesPanel.ts`, `eventLogPanel.ts`), and what closing it means there.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { clamp } from "./clamp";
import { endDragOnBlur } from "./windowDrag";
import type { DockedColumnDragResult } from "./dockedColumn";

export type DockedColumnOptions = {
  /** Width before any was stored. */
  defaultValue: number;
  /** Narrowest width the column keeps; below this a drag either snaps back or closes. */
  minWidth: number;
  /** Widest the column may get, given the width of the row it shares with the page. */
  maxWidthFor: (availableWidth: number) => number;
  /** What a drag settles on: close, or a usable width. */
  resolveDrag: (width: number, maxWidth: number) => DockedColumnDragResult;
  /** Width to reopen at after a drag closed the column. */
  restoredWidth: (lastGoodWidth: number, maxWidth: number) => number;
  /** The page area, whose width is what is left of the row. */
  stageRef: RefObject<HTMLElement | null>;
  /** The column itself, which is closed to nothing when it is not on screen. */
  paneRef: RefObject<HTMLElement | null>;
  /** Re-applies the ceiling whenever the viewer's own size changes. */
  stageSize: { width: number; height: number };
  /** Whether the backend has answered yet, and the width it remembered. */
  storedLoaded: boolean;
  storedWidth: number | null | undefined;
  /** Called once, on release, with the width the drag settled on. */
  persist: (width: number) => void;
  /** A drag shut the column: close it, at the restored width. */
  close: () => void;
};

export type DockedColumnWidth = {
  width: number;
  /** Widest the column may be right now, or `null` when the viewer is hidden. */
  maxWidth: () => number | null;
  /** Start a drag on the column's left edge. */
  resizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

export function useDockedColumnWidth({
  defaultValue,
  minWidth,
  maxWidthFor,
  resolveDrag,
  restoredWidth,
  stageRef,
  paneRef,
  stageSize,
  storedLoaded,
  storedWidth,
  persist,
  close,
}: DockedColumnOptions): DockedColumnWidth {
  const [width, setWidth] = useState(defaultValue);
  /** Last width that was wide enough to keep; restored when the drag closes it. */
  const lastGoodWidth = useRef(defaultValue);
  /** The stored width is applied once; later writes must not fight the drag. */
  const storedApplied = useRef(false);

  /**
   * Widest the column may be right now, in px.
   *
   * The column is docked beside the page, so the two split the row they sit in:
   * the stage is what is left of that row, and adding the column back gives the
   * width both are dividing. That sum is an invariant of the layout, which is why
   * this number holds still while the column is dragged, opened or closed, and
   * why the ceiling means the same thing in all three.
   *
   * `null` when the viewer is not on screen to measure — the Dashboard tab hides it —
   * in which case callers leave a width alone rather than clamping it against a
   * box nobody can see.
   */
  const maxWidth = useCallback((): number | null => {
    const stageWidth = stageRef.current?.getBoundingClientRect().width ?? 0;
    if (stageWidth <= 0) return null;
    // Closed, the column has no box to measure, and the stage already is the row.
    const columnWidth = paneRef.current?.getBoundingClientRect().width ?? 0;
    return maxWidthFor(stageWidth + columnWidth);
  }, [maxWidthFor, paneRef, stageRef]);

  // A missing or unreadable stored value just keeps the default.
  useEffect(() => {
    if (storedApplied.current || !storedLoaded) return;
    storedApplied.current = true;
    if (storedWidth != null && storedWidth > 0) {
      setWidth(clamp(storedWidth, minWidth, maxWidth() ?? maxWidthFor(0)));
    }
  }, [storedLoaded, storedWidth, minWidth, maxWidth, maxWidthFor]);

  /**
   * A width is remembered, the window is not: a column dragged wide on a large
   * screen would hang off the edge of a small one. The ceiling the drag uses is
   * re-applied whenever the viewer changes size, so the column is never wider than
   * the page area it shares — and a width that already fits is left untouched.
   */
  useLayoutEffect(() => {
    const max = maxWidth();
    if (max === null) return;
    setWidth((current) => (current > max ? max : current));
  }, [stageSize.width, stageSize.height, maxWidth]);

  /**
   * Drag the column's left edge. The width lives in state while dragging (so the
   * page reflows live) and is written once, on release, so a drag is one write
   * instead of one per pointer move.
   */
  const resizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pane = paneRef.current;
    if (!pane) return;
    event.preventDefault();
    const handle = event.currentTarget;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // The pointer can already be gone; the listeners below still work.
    }
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = pane.getBoundingClientRect().width;
    // Measured once, at the press: the row the page and the column split cannot
    // change size mid-drag.
    const ceiling = maxWidth() ?? maxWidthFor(0);
    let dragged = startWidth;

    const onMove = (move: PointerEvent) => {
      // Dragging left widens this column: the seam moves towards the page, so the
      // page gives up what the column takes. The floor is 0, not the minimum:
      // dragging all the way in is how the column is closed, and it should follow
      // the pointer while it happens.
      dragged = clamp(startWidth + (startX - move.clientX), 0, ceiling);
      if (dragged >= minWidth) lastGoodWidth.current = dragged;
      setWidth(dragged);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      stopOnBlur();
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      if (Math.abs(dragged - startWidth) < 1) return;

      const settled = resolveDrag(dragged, ceiling);
      if (settled.kind === "close") {
        // Dragged shut: close the column, and put the width back so reopening it
        // brings it back at a usable size.
        setWidth(restoredWidth(lastGoodWidth.current, ceiling));
        close();
        return;
      }

      setWidth(settled.width);
      lastGoodWidth.current = settled.width;
      // Fire and forget: forgetting the width only means the next launch starts
      // at the default.
      persist(settled.width);
    };
    // Interrupted, the column settles where the drag left it: the width is already
    // that on screen, and `onUp` is what writes it down.
    const stopOnBlur = endDragOnBlur(onUp);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  return { width, maxWidth, resizeStart };
}
