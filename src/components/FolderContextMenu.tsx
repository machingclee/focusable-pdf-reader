/**
 * The right-click menu for a folder header.
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
  onDelete: () => void;
  onClose: () => void;
};

export function FolderContextMenu({ x, y, name, stripCount, onDelete, onClose }: FolderContextMenuProps) {
  return (
    <ContextMenu x={x} y={y} label={`Actions for ${name}`} onClose={onClose}>
      <p className="strip-menu-note is-heading" role="none">
        {name}
      </p>
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
