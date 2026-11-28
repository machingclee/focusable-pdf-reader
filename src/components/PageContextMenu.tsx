/**
 * The right-click menu for a page outside the reading strip.
 *
 * The strip has a menu of its own (`onStripContextMenu` in `App`), opened when
 * the press lands inside the reading hole. This is the other case: the reader
 * right-clicked anywhere else on the page. Two actions live here, both about the
 * words under the press:
 *
 * - the highlight pen, on or off again, so arming it does not mean going back to
 *   the toolbar for the button that sits away from the passage about to be
 *   marked. The strip's menu carries the same item, so the pen answers a
 *   right-click either side of the band;
 * - "Add annotation here", which pins a piece of text to the point the press
 *   landed on. The place is measured while the menu opens, because the pointer is
 *   on the menu by the time this item is clicked.
 *
 * The shell is `ContextMenu`, so this menu is portalled, kept on screen at the
 * window edge and dismissed by every gesture the other menus honour.
 */
import { ContextMenu } from "./ContextMenu";

export function PageContextMenu({
  x,
  y,
  onToggleHighlight,
  onAddAnnotation,
  onClose,
}: {
  /** Viewport coordinates of the pointer. */
  x: number;
  y: number;
  onToggleHighlight: () => void;
  /** Pin a piece of text to the point the right-click landed on. */
  onAddAnnotation: () => void;
  onClose: () => void;
}) {
  return (
    <ContextMenu x={x} y={y} label="Page actions" onClose={onClose}>
      <button type="button" className="strip-menu-item" role="menuitem" onClick={onToggleHighlight}>
        Toggle highlight
      </button>
      <button type="button" className="strip-menu-item" role="menuitem" onClick={onAddAnnotation}>
        Add annotation here
      </button>
    </ContextMenu>
  );
}
