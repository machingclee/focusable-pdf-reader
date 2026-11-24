/**
 * The right-click menu for a page outside the reading strip.
 *
 * The strip has a menu of its own (`onStripContextMenu` in `App`), opened when
 * the press lands inside the reading hole. This is the other case: the reader
 * right-clicked anywhere else on the page. The one action is the highlight pen
 * — on, or off again — so arming it does not mean going back to the toolbar for
 * the button that sits away from the passage about to be marked. The strip's
 * menu carries the same item, so the pen answers a right-click either side of
 * the band.
 *
 * The shell is `ContextMenu`, so this menu is portalled, kept on screen at the
 * window edge and dismissed by every gesture the other menus honour.
 */
import { ContextMenu } from "./ContextMenu";

export function PageContextMenu({
  x,
  y,
  onToggleHighlight,
  onClose,
}: {
  /** Viewport coordinates of the pointer. */
  x: number;
  y: number;
  onToggleHighlight: () => void;
  onClose: () => void;
}) {
  return (
    <ContextMenu x={x} y={y} label="Page actions" onClose={onClose}>
      <button type="button" className="strip-menu-item" role="menuitem" onClick={onToggleHighlight}>
        Toggle highlight
      </button>
    </ContextMenu>
  );
}
