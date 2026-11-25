/**
 * The right-click menu for a saved strip: one implementation, shared by the
 * Dashboard tab and the docked notes column.
 *
 * The floating shell (portal, edge clamping, dismissal) lives in `ContextMenu`,
 * and so does the two-click delete; this file says which items a strip has.
 *
 * "Copy as reference" puts `[note:<id>]` on the clipboard, which is how one note
 * points at another: pasted into any note's markdown, that text renders as this
 * strip drawn inside the note. It sits first in the menu because it is the one
 * item here that does not change anything.
 *
 * "Move to folder" is a list rather than a submenu: a document has few folders,
 * and a fly-out would need its own hover timing, positioning and dismissal on top
 * of everything the shell already does. The check marks the group the strip is in
 * now — "No folder" included, which is how a strip is taken out of every folder.
 */
import { ContextMenu, ContextMenuDeleteItem } from "./ContextMenu";

export type StripContextMenuProps = {
  /** Viewport coordinates of the pointer. */
  x: number;
  y: number;
  /** The folder the strip is in now; null when it is in none. */
  currentFolderId: number | null;
  /** Every place the strip could move to: the document's folders, in order. */
  folders: { id: number; name: string }[];
  /** Move the strip to that folder, or to no folder when null. */
  onMove: (folderId: number | null) => void;
  /** Put this strip's `[note:<id>]` reference on the clipboard. */
  onCopyReference: () => void;
  onEditMarkdown: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function StripContextMenu({
  x,
  y,
  currentFolderId,
  folders,
  onMove,
  onCopyReference,
  onEditMarkdown,
  onDelete,
  onClose,
}: StripContextMenuProps) {
  return (
    <ContextMenu x={x} y={y} label="Strip actions" onClose={onClose}>
      <button type="button" className="strip-menu-item" role="menuitem" onClick={onCopyReference}>
        Copy as reference
      </button>

      <button type="button" className="strip-menu-item" role="menuitem" onClick={onEditMarkdown}>
        Markdown editor…
      </button>

      <p className="strip-menu-note is-heading" role="none">
        Move to folder
      </p>
      <div className="strip-menu-list" role="group" aria-label="Move to folder">
        {folders.map((folder) => (
          <MoveItem
            key={folder.id}
            label={folder.name}
            current={folder.id === currentFolderId}
            onSelect={() => onMove(folder.id)}
          />
        ))}
        <MoveItem label="No folder" current={currentFolderId === null} onSelect={() => onMove(null)} />
      </div>

      <ContextMenuDeleteItem
        label="Delete note"
        armedLabel="Delete this note — click again"
        onConfirm={onDelete}
      />
    </ContextMenu>
  );
}

/** One row of the move list, checked when it is where the strip already is. */
function MoveItem({ label, current, onSelect }: { label: string; current: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className="strip-menu-item is-move"
      role="menuitem"
      aria-current={current ? "true" : undefined}
      onClick={onSelect}
    >
      <span className="strip-menu-check" aria-hidden="true">
        {current ? "✓" : ""}
      </span>
      <span>{label}</span>
    </button>
  );
}
