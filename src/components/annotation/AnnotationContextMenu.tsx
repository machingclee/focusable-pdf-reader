/**
 * The right-click menu for one annotation on the page.
 *
 * A pin is a small target with a lot behind it: the text it holds, the place it
 * stands on, the reference a note can point at, and the row itself. So the menu is
 * opened by right-clicking the pin at any time — unlike a highlight, which offers
 * its delete only while the pen is armed, because a stroke has no identity of its
 * own to press. A pin does: it is a thing standing on the page, and a right-click
 * that lands on it is about it.
 *
 * There is no **Move** item: the pin is a drag handle by default (`PageAnnotation`),
 * so the gesture is the press and the drag, and letting go is what places it. A menu
 * entry would be a second way to say the same thing, and a worse one — the reader
 * would pick it and then still have to drag.
 *
 * The floating shell (portal, edge clamping, dismissal) lives in `ContextMenu`;
 * this file only says what an annotation's menu holds.
 */
import { ContextMenu, ContextMenuSeparator } from "../ContextMenu";

export function AnnotationContextMenu({
  x,
  y,
  onEdit,
  onCopyReference,
  onDelete,
  onClose,
}: {
  /** Viewport coordinates of the pointer. */
  x: number;
  y: number;
  onEdit: () => void;
  onCopyReference: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <ContextMenu x={x} y={y} label="Annotation actions" onClose={onClose}>
      <button type="button" className="strip-menu-item" role="menuitem" onClick={onEdit}>
        Edit annotation
      </button>
      <button type="button" className="strip-menu-item" role="menuitem" onClick={onCopyReference}>
        Copy as reference
      </button>
      <ContextMenuSeparator />
      {/* Deleting a pin is not the destructive case a note or a folder is: the text
          and its place are one edit, `⌘Z` brings it back under the same id, and a
          reference already pasted into a note keeps working. So the item says what
          it does and does it, the same way a highlight's does. */}
      <button
        type="button"
        className="strip-menu-item is-danger"
        role="menuitem"
        onClick={onDelete}
      >
        Delete annotation
      </button>
    </ContextMenu>
  );
}
