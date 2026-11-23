import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { PLATFORM } from "./platform";

export type AppMenuHandlers = {
  onOpen: () => void;
  onNewWindow: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFind: () => void;
  onFindNext: () => void;
  onFindPrev: () => void;
};

const NO_DOCUMENT = "No Document";

let documentItem: MenuItem | null = null;
let pendingDocumentName: string | null = null;

export async function setDocumentMenuName(name: string | null): Promise<void> {
  pendingDocumentName = name?.trim() || null;
  if (!documentItem) return;
  await documentItem.setText(pendingDocumentName || NO_DOCUMENT);
}

export async function installAppMenu(handlers: AppMenuHandlers): Promise<void> {
  // The menu is installed for macOS only, where the system draws it in the
  // global menu bar and it costs the window nothing. On Windows the same
  // `setAsAppMenu` becomes a menu bar *inside* the window, above the webview:
  // a white native strip reading "PDF Reader File Edit" that the dark app
  // cannot style. That strip is not the caption — `win32.rs` already strips
  // `WS_CAPTION`, and the custom strip below it is the app's only title bar —
  // so removing the menu is what makes the window one continuous dark surface.
  // The window loses nothing it needs: Open, Find, undo/redo and the view
  // switches are handled by `App.tsx` / `useHistoryShortcuts` (and WebView2
  // handles cut/copy/paste). Only `File → Open in New Window` had no chord
  // there, so `Ctrl+N` was added alongside this guard.
  if (PLATFORM !== "macos") return;

  documentItem = await MenuItem.new({
    id: "open-document",
    text: pendingDocumentName || NO_DOCUMENT,
    enabled: false,
  });

  const appMenu = await Submenu.new({
    text: "PDF Reader",
    items: [
      await PredefinedMenuItem.new({ item: { About: null } }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Hide" }),
      await PredefinedMenuItem.new({ item: "HideOthers" }),
      await PredefinedMenuItem.new({ item: "ShowAll" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Quit" }),
    ],
  });

  const fileMenu = await Submenu.new({
    text: "File",
    items: [
      await MenuItem.new({
        id: "open-pdf",
        text: "Open…",
        accelerator: "CmdOrCtrl+O",
        action: () => handlers.onOpen(),
      }),
      await MenuItem.new({
        id: "new-window",
        text: "Open in New Window",
        accelerator: "CmdOrCtrl+N",
        action: () => handlers.onNewWindow(),
      }),
      documentItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "CloseWindow" }),
    ],
  });

  const editMenu = await Submenu.new({
    text: "Edit",
    items: [
      await MenuItem.new({
        id: "undo",
        text: "Undo",
        action: () => handlers.onUndo(),
      }),
      await MenuItem.new({
        id: "redo",
        text: "Redo",
        action: () => handlers.onRedo(),
      }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "Cut" }),
      await PredefinedMenuItem.new({ item: "Copy" }),
      await PredefinedMenuItem.new({ item: "Paste" }),
      await PredefinedMenuItem.new({ item: "SelectAll" }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({
        id: "find",
        text: "Find…",
        accelerator: "CmdOrCtrl+F",
        action: () => handlers.onFind(),
      }),
      await MenuItem.new({
        id: "find-next",
        text: "Find Next",
        accelerator: "CmdOrCtrl+G",
        action: () => handlers.onFindNext(),
      }),
      await MenuItem.new({
        id: "find-prev",
        text: "Find Previous",
        accelerator: "Shift+CmdOrCtrl+G",
        action: () => handlers.onFindPrev(),
      }),
    ],
  });

  const menu = await Menu.new({ items: [appMenu, fileMenu, editMenu] });
  await menu.setAsAppMenu();
}
