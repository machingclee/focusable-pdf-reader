/**
 * The window's name: the open document's, or the app's when nothing is open.
 *
 * Three things carry it and they are not the same thing:
 *
 * - the webview's own `document.title`, which is what the tab and the taskbar show
 *   in a browser build;
 * - the native window's title, which is what the desktop task switcher shows;
 * - the app menu's document item — the macOS File menu's list — which belongs to
 *   the **main** window only. A viewer window opened beside it is not the app's
 *   document, so it sets its own title and leaves the menu alone.
 */
import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { setDocumentMenuName } from "./appMenu";
import { isTauri } from "./windowBridge";

export type DocumentTitleOptions = {
  /** The open document's name, or null when nothing is open. */
  sourceName: string | null;
  /** The name to fall back to. */
  appTitle: string;
  /** This window was opened beside the main one, so it is not the app's document. */
  isWindowOfItsOwn: boolean;
};

export function useDocumentTitle({
  sourceName,
  appTitle,
  isWindowOfItsOwn,
}: DocumentTitleOptions): void {
  useEffect(() => {
    const title = sourceName || appTitle;
    document.title = title;
    if (!isTauri()) return;
    void Promise.all([
      getCurrentWindow().setTitle(title),
      // The menu's document item is the main window's document; a window of its
      // own sets its own title, which is the line above.
      isWindowOfItsOwn ? Promise.resolve() : setDocumentMenuName(sourceName),
    ]).catch((cause) => {
      console.error(cause);
    });
  }, [appTitle, isWindowOfItsOwn, sourceName]);
}
