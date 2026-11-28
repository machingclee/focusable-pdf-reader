/**
 * The app menu's commands, installed into the window the reader is looking at.
 *
 * The menu itself belongs to the app, but its items act on a *window*: Open, New
 * Window, Undo, Redo, Find, Find Next, Find Previous. So each full window installs
 * the same menu, and installs it again whenever it comes forward — which is what
 * makes a command run in the window the reader is actually using rather than in
 * whichever one happened to be focused first.
 *
 * Two windows stay out of it:
 *
 * - a **reference viewer** (a window opened on one passage), because its File menu
 *   would only take Open and Find away from the window that has a document of its
 *   own;
 * - **Windows**, where the app-wide menu is drawn as a bar *inside* the window —
 *   the white strip above the app's own title strip. `installAppMenu` guards this
 *   too; bailing out here also keeps the focus listener from re-installing what
 *   Windows must not have.
 *
 * The commands are read through refs rather than listed as dependencies: the
 * handler outlives any one render, and the menu items must run the newest version
 * of each command, not the one that was current when the menu was installed.
 */
import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { installAppMenu } from "./appMenu";
import { PLATFORM } from "./platform";
import { isTauri } from "./windowBridge";

export type AppMenuCommands = {
  open: () => void;
  newWindow: () => void;
  undo: () => void;
  redo: () => void;
  find: () => void;
  findNext: () => void;
  findPrevious: () => void;
};

export type AppMenuOptions = {
  /** This window was opened on one passage: it is not the app's document window. */
  isWindowOfItsOwn: boolean;
  /** The newest version of each command, read at the moment the item is chosen. */
  commands: { current: AppMenuCommands };
};

export function useAppMenu({ isWindowOfItsOwn, commands }: AppMenuOptions): void {
  useEffect(() => {
    if (!isTauri() || isWindowOfItsOwn || PLATFORM !== "macos") return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const install = () => {
      const newest = commands.current;
      void installAppMenu({
        onOpen: () => newest.open(),
        onNewWindow: () => newest.newWindow(),
        onUndo: () => newest.undo(),
        onRedo: () => newest.redo(),
        onFind: () => newest.find(),
        onFindNext: () => newest.findNext(),
        onFindPrev: () => newest.findPrevious(),
      }).catch((cause) => {
        console.error(cause);
      });
    };
    install();
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) install();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((cause) => console.error(cause));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [commands, isWindowOfItsOwn]);
}
