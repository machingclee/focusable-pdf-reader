/**
 * The right-click menu for a folder header.
 *
 * Renaming opens the inline field the row already has for a double-click, so
 * there is one rename in the app rather than two that could drift apart.
 *
 * Deleting is the destructive one, so when the folder still holds strips the
 * armed label says exactly how many notes go with it; the caller then deletes
 * with `with_strips`. The menu is portalled and clamped by `ContextMenu` for the
 * same reasons the strip menu is.
 */
import { ContextMenu, ContextMenuDeleteItem } from "./ContextMenu";

export type FolderContextMenuProps = {
  /** Viewport coordinates of the pointer. */
  x: number;
  y: number;
  /** The folder's name, shown so the menu says which folder it acts on. */
  name: string;
  /** Strips inside it, which are deleted along with the folder. */
  stripCount: number;
  /** Open the row's name field on this folder. */
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function FolderContextMenu({
  x,
  y,
  name,
  stripCount,
  onRename,
  onDelete,
  onClose,
}: FolderContextMenuProps) {
  return (
    <ContextMenu x={x} y={y} label={`Actions for ${name}`} onClose={onClose}>
      <p className="strip-menu-note is-heading is-name-label" role="none">
        {name}
      </p>
      <button type="button" className="strip-menu-item" role="menuitem" onClick={onRename}>
        Rename folder
      </button>
      <ContextMenuDeleteItem
        label="Delete folder"
        armedLabel={
          stripCount > 0
            ? `Delete folder and its ${stripCount} strip${stripCount === 1 ? "" : "s"} — click again`
            : "Delete this folder — click again"
        }
        onConfirm={onDelete}
      />
    </ContextMenu>
  );
}
