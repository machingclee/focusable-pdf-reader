/**
 * The reading band's own menu, opened by right-clicking it.
 *
 * Two actions and a line that explains them: the strip is either a passage that
 * has no row yet or a band standing on one, so its action either creates a note
 * or writes the band's new geometry back to the row it came from. Then the two
 * tools that mark the passage in front of the reader: the pen, and the pin for a
 * piece of text. Both close the menu first, because the pen's stub follows the
 * pointer and the pin's editor opens at the press, so a menu floating over the
 * page would sit in the way.
 *
 * There is no "Copy as reference" here. A saved strip can still be pointed at from
 * another note, but that is a write to the note being composed, so it belongs to
 * the note's own menu in the notes column (`StripContextMenu`), not to the band.
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
  /**
   * Pin a piece of text to the point the right-click landed on.
   *
   * Offered only when the press resolved to a place on a page: the band can stand
   * over the gap between two pages, and there is nothing there to pin to.
   */
  onAddAnnotation?: () => void;
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
  onAddAnnotation,
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
      {/* The pin, offered beside the pen and for the same reason: the passage that
      was right-clicked is the one about to be marked, so marking it should not
      mean going back to the toolbar. */}
      {onAddAnnotation && (
        <button
          type="button"
          className="strip-menu-item"
          role="menuitem"
          onClick={() => onAddAnnotation()}
        >
          Add annotation
        </button>
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
