/**
 * The two panel shortcuts, kept out of the app's key handler so the matching can
 * be tested on its own.
 *
 * Both are matched on `event.code`, the physical key, not on `event.key`. On
 * macOS, Option remaps `key` (⌥M arrives as "µ"), so a shortcut that carries
 * Option would never match by letter. Code also means the shortcut follows the
 * key's position on non-US layouts, which is what people expect of a chord.
 */

/** The panels a shortcut opens or closes. */
export type PanelShortcut = "pages" | "notes-panel";

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
 * - ⌘⌥M toggles the "Notes of this PDF" column.
 * - Anything with Shift is left alone, so the chords can be extended later, and
 *   ⌘⌥B stays free: the markdown editor already uses it for its preview panel.
 */
export function panelShortcut(event: ShortcutKey): PanelShortcut | null {
  const meta = event.metaKey || event.ctrlKey;
  if (!meta || event.shiftKey) return null;

  if (event.altKey) return event.code === "KeyM" ? "notes-panel" : null;
  return event.code === "KeyB" ? "pages" : null;
}
