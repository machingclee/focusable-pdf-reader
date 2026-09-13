import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";

export type AppMenuHandlers = {
  onOpen: () => void;
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
      documentItem,
      await PredefinedMenuItem.new({ item: "Separator" }),
      await PredefinedMenuItem.new({ item: "CloseWindow" }),
    ],
  });

  const editMenu = await Submenu.new({
    text: "Edit",
    items: [
      await PredefinedMenuItem.new({ item: "Undo" }),
      await PredefinedMenuItem.new({ item: "Redo" }),
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
