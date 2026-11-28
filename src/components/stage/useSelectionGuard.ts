/**
 * The stage's selection guard: a double-click parks the band, and a right-click
 * opens a menu — neither should leave the words underneath picked out.
 *
 * A double-click on a page is a paragraph, not a selection: the band is drawn from
 * the box under the pointer, and a word left highlighted inside it reads as if the
 * app had chosen the passage for the reader. WebKit will also start Look Up on the
 * second press of a pair and dim the window while the button is held, so the press
 * is taken before it becomes one. The search box is left alone: selecting inside it
 * is how a query is replaced.
 *
 * A right-click is a menu. The press that opens it is not a gesture on the page,
 * but WebKit can begin a text selection from it all the same, leaving the word
 * picked out under the menu. That selection is refused, and one that had already
 * started by the time the menu opened is dropped — while a selection the reader
 * made *before* the press survives, because they may be about to copy it.
 */
import { useEffect } from "react";
import type { RefObject } from "react";

export type SelectionGuardOptions = {
  /** The stage, where the presses land. */
  stageRef: RefObject<HTMLDivElement | null>;
  /** What a double-click on the page means: park the band at that point. */
  onDoublePress: (clientX: number, clientY: number, target: EventTarget | null) => void;
};

export function useSelectionGuard({ stageRef, onDoublePress }: SelectionGuardOptions): void {
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let suppressSelection = false;
    /** The last press was not the selection button. */
    let menuPress = false;
    /** What was selected when the menu's press began, so a kept selection survives. */
    let selectedBeforeMenuPress = "";

    const onMouseDown = (event: MouseEvent) => {
      menuPress = event.button !== 0;
      selectedBeforeMenuPress = menuPress ? (window.getSelection()?.toString() ?? "") : "";
      if (event.button !== 0) {
        suppressSelection = false;
        return;
      }
      const target = event.target;
      const inSearch = target instanceof Element && target.closest(".search-bar");
      // A note badge reaches this too (its guard is in the caller): it still wants
      // the press captured, or WebKit starts Look Up on the second one, but the
      // badge's own double-click is what answers it.
      suppressSelection = event.detail >= 2 && !inSearch;
      if (!suppressSelection) return;
      // Capture the second press before WebKit starts Look Up or a page-wide
      // selection, both of which dim the window while the button is held.
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      onDoublePress(event.clientX, event.clientY, event.target);
    };
    const onSelectStart = (event: Event) => {
      if (!suppressSelection && !menuPress) return;
      event.preventDefault();
    };
    /** A menu's press must not leave the text it landed on selected. */
    const dropMenuPressSelection = () => {
      if (!menuPress) return;
      const selection = window.getSelection();
      if (!selection || selection.toString() === selectedBeforeMenuPress) return;
      selection.removeAllRanges();
    };
    const onContextMenu = () => dropMenuPressSelection();
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 2) dropMenuPressSelection();
      menuPress = false;
    };
    stage.addEventListener("mousedown", onMouseDown, true);
    stage.addEventListener("selectstart", onSelectStart, true);
    stage.addEventListener("contextmenu", onContextMenu, true);
    // On the window: a right-press may be released outside the page, and the
    // next selection must not be refused because that press never ended here.
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("pointerup", onMouseUp, true);
    return () => {
      stage.removeEventListener("mousedown", onMouseDown, true);
      stage.removeEventListener("selectstart", onSelectStart, true);
      stage.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("pointerup", onMouseUp, true);
    };
  }, [onDoublePress, stageRef]);
}
