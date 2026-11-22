/**
 * The right-click menu for a row in the Notes document list.
 *
 * Open PDF makes that document the one on screen. Rename closes the menu and
 * the row replaces its name with the field. Delete takes two clicks, the same
 * way a folder or a strip does, and the armed label says when the document's
 * strips go with it. The shell is the shared one, so this menu is portalled
 * and clamped like the others.
 */
import { ContextMenu, ContextMenuDeleteItem } from "./ContextMenu";

export type DocumentContextMenuProps = {
  /** Viewport coordinates of the pointer. */
  x: number;
  y: number;
  /** The document's name, shown so the menu says which row it acts on. */
  name: string;
  /** Strips stored on it, which are deleted along with the document. */
  stripCount: number;
  /** Show this document's PDF in the viewer. */
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function DocumentContextMenu({
  x,
  y,
  name,
  stripCount,
  onOpen,
  onRename,
  onDelete,
  onClose,
}: DocumentContextMenuProps) {
  return (
    <ContextMenu x={x} y={y} label={`Actions for ${name}`} onClose={onClose}>
      <p className="strip-menu-note is-heading notes-doc-menu-name" role="none">
        {name}
      </p>
      <button type="button" className="strip-menu-item" role="menuitem" onClick={onOpen}>
        Open PDF
      </button>
      <button type="button" className="strip-menu-item" role="menuitem" onClick={onRename}>
        Rename
      </button>
      <ContextMenuDeleteItem
        label="Delete document"
        armedLabel={
          stripCount > 0
            ? `Delete document and its ${stripCount} strip${stripCount === 1 ? "" : "s"} — click again`
            : "Delete this document — click again"
        }
        onConfirm={onDelete}
      />
    </ContextMenu>
  );
}
