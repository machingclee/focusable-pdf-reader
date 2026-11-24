/**
 * The right-click menu for a page outside the reading strip.
 *
 * The strip has a menu of its own (`onStripContextMenu` in `App`), opened when
 * the press lands inside the reading hole. This is the other case: the reader
 * right-clicked a passage they have not framed — no strip yet, or the strip is
 * somewhere else on the page — and the answer is the paragraph under the
 * pointer. The one action is the one a passage offers without being open: mark
 * its lines, or take the marks away.
 *
 * The shell is `ContextMenu`, so this menu is portalled, kept on screen at the
 * window edge and dismissed by every gesture the other menus honour.
 */
import { ContextMenu } from "./ContextMenu";

export function PageContextMenu({
  x,
  y,
  marked,
  onToggleHighlight,
  onClose,
}: {
  /** Viewport coordinates of the pointer. */
  x: number;
  y: number;
  /** The paragraph under the pointer already has a highlight over it. */
  marked: boolean;
  onToggleHighlight: () => void;
  onClose: () => void;
}) {
  return (
    <ContextMenu x={x} y={y} label="Page actions" onClose={onClose}>
      <button type="button" className="strip-menu-item" role="menuitem" onClick={onToggleHighlight}>
        {marked ? "Remove highlight" : "Highlight this paragraph"}
      </button>
    </ContextMenu>
  );
}
