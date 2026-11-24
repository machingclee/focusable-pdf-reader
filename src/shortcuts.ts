/**
 * The panel shortcuts, kept out of the app's key handler so the matching can be
 * tested on its own.
 *
 * All of them are matched on `event.code`, the physical key, not on `event.key`.
 * On macOS, Option remaps `key` (⌥B arrives as "∫"), so a shortcut that carries
 * Option would never match by letter. Code also means the shortcut follows the
 * key's position on non-US layouts, which is what people expect of a chord.
 */

/** What a panel shortcut does: open or close a panel, or pop one out. */
export type PanelShortcut = "pages" | "notes-panel" | "notes-window";

export type ShortcutKey = {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/**
 * Which panel shortcut this keystroke is, or null.
 *
 * - ⌘B toggles the Pages rail.
 * - ⌘⌥B toggles the "Notes of this PDF" column.
 * - ⌘⌥⇧B shows those notes in a window of their own — the column's pop-out
 *   button by another route.
 *
 * ⇧⌘B stays unbound: the rail's chord does not grow that way, and Shift is the
 * axis the notes chords grow along.
 *
 * The markdown editor also uses ⌘⌥B, for its preview pane, but not ⌘⌥⇧B. That
 * chord only exists while the note dialog is open, and the callers yield when the
 * press starts inside `.note-backdrop`, so the editor keeps it there.
 */
export function panelShortcut(event: ShortcutKey): PanelShortcut | null {
  const meta = event.metaKey || event.ctrlKey;
  if (!meta || event.code !== "KeyB") return null;

  if (event.altKey) return event.shiftKey ? "notes-window" : "notes-panel";
  return event.shiftKey ? null : "pages";
}

/**
 * Which way ⌥← / ⌥→ walks the PDF's scroll marks, or null.
 *
 * Matched on `code`. Option remaps `key` on macOS, and a text field keeps the
 * chord for its own word-by-word movement. Command and Shift stay free.
 */
export function scrollHistoryShortcut(event: ShortcutKey): -1 | 1 | null {
  const meta = event.metaKey || event.ctrlKey;
  if (!event.altKey || meta || event.shiftKey) return null;
  if (event.code === "ArrowLeft") return -1;
  if (event.code === "ArrowRight") return 1;
  return null;
}
