/**
 * Library undo and redo, kept beside the panel shortcuts so the matching can be
 * tested on its own.
 *
 * Matched on `event.code`, the physical key. Cmd+Z undoes. Cmd+Y and
 * Cmd+Shift+Z redo. Text fields and the markdown editor keep those chords.
 */

export type HistoryShortcut = "undo" | "redo";

export type ShortcutKey = {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/**
 * Which history chord this keystroke is, or null.
 *
 * Option is left alone, so this cannot collide with a panel chord.
 */
export function historyShortcut(event: ShortcutKey): HistoryShortcut | null {
  const meta = event.metaKey || event.ctrlKey;
  if (!meta || event.altKey) return null;
  if (event.code === "KeyZ" && !event.shiftKey) return "undo";
  if (event.code === "KeyY" && !event.shiftKey) return "redo";
  if (event.code === "KeyZ" && event.shiftKey) return "redo";
  return null;
}

/**
 * A field or the markdown editor that is actually on screen.
 *
 * The PDF view stays mounted while Notes is showing, only hidden. A page box
 * or editor left focused there would swallow Ctrl+Z and undo nothing the
 * reader can see.
 */
export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (typeof Element === "undefined") return false;
  if (!(target instanceof Element)) return false;
  const field = target.closest("input, textarea, select, [contenteditable='true'], .monaco-editor");
  if (!field) return false;
  if (field.closest(".is-hidden")) return false;
  if (typeof field.getClientRects === "function" && field.getClientRects().length === 0) return false;
  return true;
}
