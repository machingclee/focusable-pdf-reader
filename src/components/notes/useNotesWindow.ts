/**
 * The notes column, wherever it lives: docked beside the page, or in a window of
 * its own.
 *
 * The app has one set of notes and two homes for them, and every control that
 * reveals them has to work in both: a badge's click, ⌘⌥B, ⌘⌥⇧B, the toolbar's
 * button, a reference clicked in the other window. So the answers — is the column
 * on screen, is it docked, what does "show the notes" mean right now — live in one
 * place, reading `panelsSlice` and moving between the two homes.
 *
 * Two rules are worth knowing:
 *
 * - **Popped out, revealing means raising.** The column is not in this window, so
 *   there is nothing here to open; the window that has it comes forward, which is
 *   also what makes the typing a saved strip asked for land in the right editor.
 * - **Closing the window docks the column again, open.** The reader asked for
 *   these notes and then closed the window that was showing them; leaving the
 *   column merely available would read as having lost them. Watched through
 *   `tauri://destroyed` rather than `close-requested`, because the requirement is
 *   about the window being gone, however it went — the traffic light, the dock
 *   button, ⌘⌥B inside it, or Rust closing it after the main window went down.
 */
import { useCallback } from "react";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  notesDetachedChanged,
  notesPanelOpened,
  notesPanelToggled,
  selectNotesDetached,
  selectNotesOpen,
  toastShown,
} from "../../store/slices/panelsSlice";
import { getNotesWindow, isTauri, openNotesWindow } from "../../windowBridge";
import { loadNotesWindowRect } from "../../notesWindowGeometry";

export type NotesWindow = {
  /** The column is in this window's row, on screen. */
  open: boolean;
  /** The column lives in a window of its own. */
  detached: boolean;
  /** The notes are on screen somewhere: the toolbar's button is pressed either way. */
  onScreen: boolean;
  /** Show them, in whichever home they have. */
  show: () => void;
  /** The toolbar button and ⌘⌥B: toggle when docked, raise when popped out. */
  toggle: () => void;
  /** Move them into a window of their own (or raise that window). */
  revealWindow: () => void;
  /** The dock button in the popped-out window's header. */
  detach: () => Promise<void>;
  /** Adopt a window found after a reload of this one. */
  watchClose: (win: WebviewWindow) => Promise<() => void>;
};

export type NotesWindowOptions = {
  /** This window was opened beside the main one, so it must not pop the column out. */
  isWindowOfItsOwn: boolean;
};

export function useNotesWindow({ isWindowOfItsOwn }: NotesWindowOptions): NotesWindow {
  const dispatch = useAppDispatch();
  const open = useAppSelector(selectNotesOpen);
  const detached = useAppSelector(selectNotesDetached);

  const focusNotesWindow = useCallback(() => {
    void getNotesWindow()
      .then((win) => win?.setFocus())
      .catch((cause) => console.error(cause));
  }, []);

  const show = useCallback(() => {
    if (detached) focusNotesWindow();
    else dispatch(notesPanelOpened(true));
  }, [detached, dispatch, focusNotesWindow]);

  const toggle = useCallback(() => {
    if (detached) focusNotesWindow();
    else dispatch(notesPanelToggled());
  }, [detached, dispatch, focusNotesWindow]);

  const watchClose = useCallback(
    async (win: WebviewWindow) => {
      const unlisten = await win.once("tauri://destroyed", () => {
        dispatch(notesDetachedChanged(false));
        // The reader asked for these notes and then closed the window that was
        // showing them; the column comes back open rather than merely available.
        dispatch(notesPanelOpened(true));
      });
      return unlisten;
    },
    [dispatch],
  );

  const detach = useCallback(async () => {
    try {
      const win = await openNotesWindow(loadNotesWindowRect());
      dispatch(notesDetachedChanged(true));
      // Watched for the window's whole life, so no cleanup is kept here.
      await watchClose(win);
    } catch (cause) {
      console.error(cause);
      // Staying docked is the useful failure: the column is still on screen.
      dispatch(toastShown("Could not open the notes window."));
    }
  }, [dispatch, watchClose]);

  const revealWindow = useCallback(() => {
    if (detached) {
      focusNotesWindow();
      return;
    }
    if (!isTauri() || isWindowOfItsOwn) {
      // No bridge (the plain web build), or a window that must not take over the
      // notes window of the app that opened it: reveal the docked column instead
      // of doing nothing.
      dispatch(notesPanelOpened(true));
      return;
    }
    void detach();
  }, [detached, dispatch, focusNotesWindow, detach, isWindowOfItsOwn]);

  return {
    open,
    detached,
    onScreen: open || detached,
    show,
    toggle,
    revealWindow,
    detach,
    watchClose,
  };
}
