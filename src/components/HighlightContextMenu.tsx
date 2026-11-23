/**
 * The right-click menu for one saved highlight on the page.
 *
 * The `×` on a stroke's corner is a small target at the end of a long stroke —
 * exactly the thing a pointer is worst at — so the stroke itself is the wider
 * target: a right-click anywhere on it offers the same removal. The item asks
 * twice, like every destructive item in the app, because a menu is one stray
 * click away from lost work.
 *
 * The floating shell (portal, edge clamping, dismissal) lives in `ContextMenu`;
 * this file only says what a highlight's menu holds.
 */
import { ContextMenu, ContextMenuDeleteItem } from "./ContextMenu";

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
      <ContextMenuDeleteItem
        label="Delete highlight"
        armedLabel="Delete this highlight — click again"
        onConfirm={onDelete}
      />
    </ContextMenu>
  );
}
