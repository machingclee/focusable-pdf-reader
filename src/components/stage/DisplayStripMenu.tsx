/**
 * The reading band's own menu, opened by right-clicking it.
 *
 * Two actions and a line that explains them: the strip is either a passage that
 * has no row yet or a band standing on one, so its action either creates a note
 * or writes the band's new geometry back to the row it came from. The third item
 * is the pen, offered from the band it is about to mark — and it closes the menu
 * first, because the pen's stub follows the pointer and a menu floating over the
 * page would sit in the way of the drag.
 *
 * A saved strip can be copied as a reference, which is what a note elsewhere
 * points at it by; a passage that has not been saved yet has no id to point at,
 * so that item appears only once the band stands on a row.
 */
import type { RefObject } from "react";
import { ContextMenuSeparator } from "../ContextMenu";

/**
 * The band menu's one action, named for the write it will do.
 *
 * A band parked on a saved strip is that row, so its action updates the row; a
 * band parked on a passage has no row yet, so its action creates one. Two names
 * for two writes, so the label never promises the wrong one.
 */
function stripMenuCopy(updating: boolean): { action: string; busy: string; hint: string } {
  return updating
    ? {
      action: "Update note",
      busy: "Updating...",
      hint: "Writes this position and size back to the strip it came from.",
    }
    : {
      action: "Save note",
      busy: "Saving...",
      hint: "Adds this strip to the open document, with an optional note.",
    };
}

export type DisplayStripMenuProps = {
  x: number;
  y: number;
  menuRef: RefObject<HTMLDivElement | null>;
  /** The band is standing on a saved strip, so the action updates that row. */
  updating: boolean;
  /** The write in flight, and the reason the last one failed. */
  saveState: "idle" | "saving" | "saved" | "error";
  saveMessage: string | null;
  onSave: () => void;
  /** The pen, armed at the brush the press measured. */
  onToggleHighlight: () => void;
  /** Copy the saved strip's reference — only once the band stands on a row. */
  onCopyReference?: () => void;
};

export function DisplayStripMenu({
  x,
  y,
  menuRef,
  updating,
  saveState,
  saveMessage,
  onSave,
  onToggleHighlight,
  onCopyReference,
}: DisplayStripMenuProps) {
  const copy = stripMenuCopy(updating);
  return (
    <div
      className="strip-menu"
      ref={menuRef}
      style={{ left: x, top: y }}
      role="menu"
      aria-label="Display strip actions"
    >
      <button
        type="button"
        className="strip-menu-item"
        role="menuitem"
        disabled={saveState === "saving"}
        onClick={() => onSave()}
      >
        {saveState === "saving" ? copy.busy : copy.action}
      </button>
      <ContextMenuSeparator />
      <button
        type="button"
        className="strip-menu-item"
        role="menuitem"
        onClick={() => onToggleHighlight()}
      >
        Toggle highlight
      </button>
      {/* A passage that has not been saved yet has no id to point at, so
      the reference item appears once the band stands on a row. */}
      {onCopyReference && (
        <>
          <ContextMenuSeparator />
          <button
            type="button"
            className="strip-menu-item"
            role="menuitem"
            onClick={() => onCopyReference()}
          >
            Copy as reference
          </button>
        </>
      )}
      <div
        className={`strip-menu-note${saveState === "error" ? " is-error" : ""}`}
        role="status"
      >
        {saveMessage ?? copy.hint}
      </div>
    </div>
  );
}
