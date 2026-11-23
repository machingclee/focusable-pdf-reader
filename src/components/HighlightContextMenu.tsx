/**
 * The right-click menu for one saved highlight on the page.
 *
 * The `×` on a stroke's corner is a small target at the end of a long stroke —
 * exactly the thing a pointer is worst at — so the stroke itself is the wider
 * target: a right-click anywhere on it offers removal.
 *
 * This is the one delete in the app that acts on the first click. The others ask
 * twice because a note, a folder or a document can hold an afternoon of work and
 * a menu is one stray click from it. A stroke holds a single drag: laying it
 * again is cheaper than the second click it would take to confirm its removal,
 * and `⌘Z` brings it back if the click was a mistake. So the item says what it
 * does and does it — the danger colour is the warning.
 *
 * The floating shell (portal, edge clamping, dismissal) lives in `ContextMenu`;
 * this file only says what a highlight's menu holds.
 */
import { ContextMenu } from "./ContextMenu";

export function HighlightContextMenu({
  x,
  y,
  onDelete,
  onClose,
}: {
  /** Viewport coordinates of the pointer. */
  x: number;
  y: number;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <ContextMenu x={x} y={y} label="Highlight actions" onClose={onClose}>
      <button
        type="button"
        className="strip-menu-item is-danger"
        role="menuitem"
        onClick={onDelete}
      >
        Delete highlight
      </button>
    </ContextMenu>
  );
}
