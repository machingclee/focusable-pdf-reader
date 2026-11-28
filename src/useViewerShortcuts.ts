/**
 * The viewer's keyboard: every key the app answers, in one place and in order.
 *
 * The order is the design, so it is written as one list rather than as listeners
 * scattered over the components that happen to care. From the top:
 *
 * 1. **The tab switch** — ⌘1 / ⌘2, which work from either tab and so come before
 *    the guard that keeps the viewer's shortcuts to the PDF tab.
 * 2. **The markdown popup** — a note's, or a pin's **Edit with preview**. It is
 *    modal and holds writing nobody has saved, so Escape is left to the popup
 *    itself (its own search first, then its cancel) rather than claimed by a layer
 *    behind it.
 * 3. **The innermost layer of the annotation tool** — a pin in the hand, the pin
 *    being written, its menu, then the tool itself. Each is one Escape step, and
 *    each is answered before anything that could also claim the key.
 * 4. **The pen's own surfaces** — a highlight's menu, then a stroke being drawn in
 *    another window (`highlightSessionKey`).
 * 5. **Escape as "one layer back"**, delegated to `closeOverlays` (whose order is
 *    `escapeDismiss.ts`). The Dashboard's Escape is its own branch: the log it can
 *    raise is the only layer that tab has.
 * 6. **The notes surfaces' guard** — the docked column, the Dashboard, the markdown
 *    popup and the event log own their keyboards: typing a note must not also zoom
 *    the page. Two chords still reach the viewer from inside the column (⌘⌥B and
 *    ⌘⌥⇧B), because they are how that column is raised and popped out.
 * 7. **Everything the PDF tab answers** — the scroll history, the panel chords, find
 *    and its next/previous, Open, New Window on Windows, the zoom chords, and the
 *    bare letters: `T` pages, `H` the pen, `A` the annotation tool,
 *    `[` / `]` the strip's height, `↑` / `↓` the band.
 *
 * There is no bare letter for the reading strip. It used to be `F`, and a bare
 * letter on the page is a press that answers for the whole window: the strip is
 * entered the way the reader picks the passage it frames — a double-click on a
 * paragraph, or a `⌘`-drag — and left with `Esc`.
 *
 * Two of those go through refs rather than being read from this render: `H` and `A`
 * toggle tools whose handlers are installed once, and the pen's brush is measured
 * from the pointer's last place (`pointerSpot`), because a key press carries no
 * coordinates.
 *
 * The listener is on the window in the capture phase: a press inside the page has
 * to be seen before the page's own controls answer it, and `preventDefault` here is
 * what keeps a bare letter out of the document.
 */
import { useEffect } from "react";
import type { RefObject } from "react";
import type { AppTab } from "./components/TitleBar";
import type { PdfSearch } from "./components/search/usePdfSearch";
import type { LoadedPdf } from "./pdf";
import { escapeKeptByEditor } from "./escapeDismiss";
import { isTypingTarget } from "./isTypingTarget";
import { PLATFORM } from "./platform";
import { pointerSpot } from "./pointerSpot";
import { panelShortcut, scrollHistoryShortcut } from "./shortcuts";
import { highlightSessionKey } from "./stripHighlight";
import { STRIP_STEP, stripScreenPx } from "./stripMetrics";
import { brushUnderPoint } from "./textBrush";
import { ZOOM_STEP } from "./viewerLimits";
import type { Annotation } from "./types/dto";
import type { AnnotationDrag } from "./components/annotation/usePinGesture";

/** The note being written, as the keyboard sees it. */
type AnnotationDraftState = {
  mode: "new" | "edit";
  id: number | null;
  page: number;
  point: { x: number; y: number };
  x: number;
  y: number;
  text: string;
};

export type ViewerShortcutOptions = {
  /** Which tab is on screen. */
  view: AppTab;
  switchView: (view: AppTab) => void;
  /** The open document, and the two tools whose state the keys read. */
  pdf: LoadedPdf | null;
  focusMode: boolean;
  annotationMode: boolean;
  annotationDraft: AnnotationDraftState | null;
  annotationMove: AnnotationDrag | null;
  annotationMenu: { annotation: Annotation; x: number; y: number } | null;
  /** A saved highlight's menu: Escape closes it and leaves the pen armed. */
  highlightMenu: { page: number; x: number; y: number } | null;
  setAnnotationMove: (move: AnnotationDrag | null) => void;
  setAnnotationDraft: (draft: AnnotationDraftState | null) => void;
  setAnnotationError: (error: string | null) => void;
  setAnnotationMenu: (menu: null) => void;
  setAnnotationMode: (armed: boolean) => void;
  setHighlightMenu: (menu: null) => void;
  setEventLogOpen: (open: boolean) => void;
  toggleRail: () => void;
  setStripHeight: (pt: number) => void;
  /** Escape's one-layer-back order, and the find box it closes. */
  closeOverlays: () => boolean;
  eventLogOpen: boolean;
  search: PdfSearch;
  searchInputRef: RefObject<HTMLInputElement | null>;
  /** Moving around the document. */
  stepPdfScrollHistory: (direction: -1 | 1) => void;
  bumpZoom: (factor: number) => void;
  fitWidth: () => void;
  /** The columns. */
  toggleNotesPanel: () => void;
  revealNotesWindow: () => void;
  /** Opening. */
  openWithPicker: () => void;
  /** The strip's height and the band's nudges, read without a render. */
  stripHeightRef: RefObject<number>;
  zoomRef: RefObject<number>;
  /** The tools' own toggles, which outlive this render. */
  toggleHighlightPenRef: { current: (brushPt?: number | null) => void };
  toggleAnnotationToolRef: { current: () => void };
  nudgeFocusStripRef: { current: (deltaY: number) => void };
  openAppWindowRef: { current: () => void };
};

export function useViewerShortcuts(options: ViewerShortcutOptions): void {
  const {
    view,
    switchView,
    pdf,
    focusMode,
    annotationMode,
    annotationDraft,
    annotationMove,
    annotationMenu,
    highlightMenu,
    setAnnotationMove,
    setAnnotationDraft,
    setAnnotationError,
    setAnnotationMenu,
    setAnnotationMode,
    setHighlightMenu,
    setEventLogOpen,
    toggleRail,
    setStripHeight,
    closeOverlays,
    eventLogOpen,
    search,
    searchInputRef,
    stepPdfScrollHistory,
    bumpZoom,
    fitWidth,
    toggleNotesPanel,
    revealNotesWindow,
    openWithPicker,
    stripHeightRef,
    zoomRef,
    toggleHighlightPenRef,
    toggleAnnotationToolRef,
    nudgeFocusStripRef,
    openAppWindowRef,
  } = options;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;

      // The view switch works from either tab, so it comes before the guard
      // below that keeps the viewer's own shortcuts to the PDF tab.
      if (meta && (event.key === "1" || event.key === "2")) {
        event.preventDefault();
        switchView(event.key === "1" ? "pdf" : "dashboard");
        return;
      }
      /* A markdown popup — the notes column's, or a pin's **Edit with preview** —
         is holding text nobody has saved yet, and it answers Escape itself: its
         preview search first, then its own cancel. It is modal and stands over
         every layer below, so the key is not the viewer's while one is up,
         whichever layer would otherwise claim it. This is the same popup
         `escapeKeptByEditor` recognises further down; it is checked here because
         the annotation layers below deliberately sit above that guard, and Escape
         on a pin's popup must not put the armed tool away instead. Recognised by
         being open, not by where the press started: its preview pane takes no
         focus. */
      if (event.key === "Escape" && document.querySelector(".note-backdrop")) return;

      /* A pin in the hand is the innermost layer there is: Escape abandons the drag
         and leaves everything else alone. Nothing is written until the hand opens,
         so the piece simply goes back to the row it still has. The move reads the
         pointer, so it is answered before any layer that could also claim the key. */
      if (annotationMove) {
        if (event.key === "Escape") {
          event.preventDefault();
          setAnnotationMove(null);
          return;
        }
      }
      /* An annotation being written is holding text, so Escape is the box's and not
         the viewer's: it drops the draft and leaves the tool armed. The same key
         closes a pin's menu; only a third press puts the tool down. This sits above
         the pen's own Escape because a draft over the page is the innermost layer
         there is. */
      if (event.key === "Escape" && annotationDraft) {
        event.preventDefault();
        setAnnotationDraft(null);
        setAnnotationError(null);
        return;
      }
      if (event.key === "Escape" && annotationMenu) {
        event.preventDefault();
        setAnnotationMenu(null);
        return;
      }
      if (event.key === "Escape" && annotationMode) {
        event.preventDefault();
        setAnnotationMode(false);
        return;
      }
      // A highlight's menu is the pen's own surface. Escape closes the menu and
      // leaves the pen armed, so the press still has a step to take before it
      // would put the pen down — the menu is a layer over the pen, not over it.
      if (event.key === "Escape" && highlightMenu) {
        event.preventDefault();
        setHighlightMenu(null);
        return;
      }
      // A note preview has the pen down. `[` / `]` size that brush, and Escape
      // cancels the stroke, ahead of the reading strip and the columns.
      if (highlightSessionKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // The notes surfaces (docked column, Dashboard tab, markdown popup) own the
      // keyboard while the event starts inside them: they bind their own ⌘F, ⌘S
      // and zoom keys, and typing a note must not also zoom the page or toggle
      // focus mode.
      const target = event.target instanceof Element ? event.target : null;

      /* Escape steps back **one layer** per press. While the reading strip is on,
         that layer is the strip: it takes the key ahead of the event log, the
         band's menu, the search bar and the notes column. The order and the
         reasoning are in `escapeDismiss.ts`. It sits above the notes-surface guard
         below on purpose: once a card has been clicked the press starts *inside*
         the column, and with the strip on that is exactly when the strip should
         go away, leaving the column where it was.

         With the strip off, the event log is the first layer, and it closes
         alone: it is a column watched while the viewer is used, not a modal, so
         a press while it is up must not also empty the find field.

         Two surfaces keep their own Escape, because each is holding text the
         reader is in the middle of writing: the markdown popup (which may have an
         unsaved note) and a note field or the inline card editor (where Escape
         means "drop this edit"). The popup is recognised by being open rather
         than by where the press started — its preview pane takes no focus, so a
         click there used to hand the key to the viewer, which closed the column
         behind the popup. */
      if (event.key === "Escape" && view === "pdf") {
        const keptByEditor = escapeKeptByEditor({
          noteDialogOpen: Boolean(document.querySelector(".note-backdrop")),
          typingInNotes:
            isTypingTarget(event.target) && Boolean(target?.closest(".doc-notes, .notes")),
        });
        if (keptByEditor) return;
        // Only claim the key when the press actually closed something.
        if (closeOverlays()) event.preventDefault();
        return;
      }

      /* The Dashboard's Escape. The tab has one layer of its own — the log it can
         now raise — and puts that away, claiming the key only when it did. The
         editor rule above applies here too: a note field, the markdown popup or
         the tag field is holding text, so the press is theirs, not the column's.
         Nothing else on this tab is a layer, which is why this is its own branch
         rather than a `view` widened on the one above: the PDF's overlays are not
         on screen to close. */
      if (event.key === "Escape" && view === "dashboard" && eventLogOpen) {
        const keptByEditor = escapeKeptByEditor({
          noteDialogOpen: Boolean(document.querySelector(".note-backdrop")),
          typingInNotes:
            isTypingTarget(event.target) && Boolean(target?.closest(".doc-notes, .notes")),
        });
        if (keptByEditor) return;
        // The page preview is the layer in front of the log. Its own listener
        // closes it; this press must not also put the log away.
        if (document.querySelector(".notes-doc-preview")) return;
        event.preventDefault();
        setEventLogOpen(false);
        return;
      }

      /* Two chords still reach the viewer from inside the column: ⌘⌥B is how the
         column itself is raised and closed, and ⌘⌥⇧B pops it out or raises the
         window it is already in, so a press that starts in it — a card was just
         clicked, a note field has focus — has to land. Everything else stays the
         notes surfaces' own, and the markdown popup keeps ⌘⌥B too: it is modal,
         and closing the column behind it would move the page under the note being
         written. The popup is recognised by being open, not by where the press
         started — its preview pane takes no focus, and the same chord toggles that
         preview. (⌘⌥⇧B is not a chord the popup knows, so it stays with the
         viewer even then.) */
      if (
        view === "pdf" &&
        target?.closest(".doc-notes") &&
        !document.querySelector(".note-backdrop")
      ) {
        const notesChord = panelShortcut(event);
        if (notesChord === "notes-panel" || notesChord === "notes-window") {
          event.preventDefault();
          event.stopPropagation();
          if (notesChord === "notes-window") revealNotesWindow();
          else toggleNotesPanel();
          return;
        }
      }

      /* The docked columns own their keyboards the same way: typing a request id
         into the event log must not also toggle focus mode or the pages rail, and
         its own controls are what answer the keys pressed inside it. */
      if (target?.closest(".doc-notes, .notes, .note-backdrop, .event-log-panel")) return;

      if (view !== "pdf") return;

      // ⌥← and ⌥→ walk the same scroll marks as the toolbar buttons. A text
      // field keeps the chord: Option+arrow moves by a word there.
      const scrollStep = scrollHistoryShortcut(event);
      if (scrollStep) {
        if (!pdf || isTypingTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        stepPdfScrollHistory(scrollStep);
        return;
      }

      // The panel chords. All move the same state their buttons do: ⌘B closes the
      // Pages rail when it is in the way and brings it back, ⌘⌥B does the same
      // for the notes column, and ⌘⌥⇧B moves that column into a window of its
      // own (or raises it, when it is already out).
      const shortcut = panelShortcut(event);
      if (shortcut === "pages") {
        if (!pdf) return;
        event.preventDefault();
        event.stopPropagation();
        toggleRail();
        return;
      }
      if (shortcut === "notes-panel") {
        if (!pdf || document.querySelector(".note-backdrop")) return;
        event.preventDefault();
        event.stopPropagation();
        // Toggles the column when it is docked; when it is popped out, there is
        // nothing here to toggle, so the chord raises that window instead.
        toggleNotesPanel();
        return;
      }
      if (shortcut === "notes-window") {
        if (!pdf || document.querySelector(".note-backdrop")) return;
        event.preventDefault();
        event.stopPropagation();
        revealNotesWindow();
        return;
      }
      if (meta && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        search.openSearch();
        return;
      }
      if (search.open && meta && event.key.toLowerCase() === "g") {
        event.preventDefault();
        search.stepHit(event.shiftKey ? -1 : 1);
        return;
      }
      if (search.open && event.key === "Enter" && event.target === searchInputRef.current) {
        if (!event.shiftKey) return;
        event.preventDefault();
        search.stepHit(-1);
        return;
      }
      if (meta && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void openWithPicker();
        return;
      }
      // On macOS this chord belongs to the File menu's "Open in New Window".
      // Windows has no app menu any more, so the same command keeps its chord
      // through the app's own key handler. Guarded by platform so the menu and
      // this handler can never both open a window for one press.
      if (PLATFORM !== "macos" && meta && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openAppWindowRef.current();
        return;
      }
      if (meta && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        bumpZoom(ZOOM_STEP);
        return;
      }
      if (meta && event.key === "-") {
        event.preventDefault();
        bumpZoom(1 / ZOOM_STEP);
        return;
      }
      if (meta && event.key === "0") {
        event.preventDefault();
        fitWidth();
        return;
      }
      if (event.key.toLowerCase() === "t" && !meta && !event.altKey) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        toggleRail();
        return;
      }
      // H is the highlight pen, on or off — the same toggle as the toolbar's
      // Highlight button and the right-click menus. It goes through a ref
      // because the handler is installed once and the pen's state is whichever
      // render is current.
      //
      // The pen also starts at the line under the pointer, exactly as the page's
      // right-click menu does, so the key and the menu arm the same brush over
      // the same words. A key press carries no coordinates, so the pointer's
      // last move is what "under the pointer" means; bare paper — or a pointer
      // not seen since the window opened — leaves the pen at its own thickness.
      if (event.key.toLowerCase() === "h" && !meta && !event.altKey) {
        if (isTypingTarget(event.target)) return;
        if (event.repeat || event.isComposing) return;
        event.preventDefault();
        const spot = pointerSpot();
        toggleHighlightPenRef.current(spot ? brushUnderPoint(spot.x, spot.y) : null);
        return;
      }
      // A is the annotation tool, on or off — the same toggle as the toolbar's
      // Annotate button and the page's right-click menu. It goes through a ref for
      // the same reason H does: the handler is installed once, and the tool's state
      // is whichever render is current.
      if (event.key.toLowerCase() === "a" && !meta && !event.altKey) {
        if (isTypingTarget(event.target)) return;
        if (event.repeat || event.isComposing) return;
        event.preventDefault();
        toggleAnnotationToolRef.current();
        return;
      }
      if (
        event.code === "BracketLeft" ||
        event.code === "BracketRight" ||
        event.key === "[" ||
        event.key === "]"
      ) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        const direction = event.code === "BracketRight" || event.key === "]" ? 1 : -1;
        const step = event.altKey
          ? 1
          : STRIP_STEP * (event.shiftKey ? 3 : 1) * (meta ? 3 : 1);
        setStripHeight(stripHeightRef.current + direction * step);
        return;
      }
      if (focusMode && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        const distance = event.altKey
          ? 1
          : stripScreenPx(stripHeightRef.current, zoomRef.current);
        nudgeFocusStripRef.current((event.key === "ArrowDown" ? 1 : -1) * distance);
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    annotationDraft,
    annotationMenu,
    annotationMode,
    annotationMove,
    bumpZoom,
    closeOverlays,
    search.closeSearch,
    eventLogOpen,
    fitWidth,
    focusMode,
    highlightMenu,
    search.openSearch,
    openWithPicker,
    pdf,
    revealNotesWindow,
    search.open,
    setStripHeight,
    search.stepHit,
    stepPdfScrollHistory,
    switchView,
    toggleNotesPanel,
    view,
  ]);
}
