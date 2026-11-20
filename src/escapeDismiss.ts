/**
 * What one Escape press closes.
 *
 * Escape is the "get me out" key, so it closes **every** overlay that is open in
 * a single press — the band's menu, the search bar, the notes column and the
 * reading strip — instead of one layer per press. Dismissing them one at a time
 * made the key answer with something other than what it looked like it would do:
 * a column plus a search plus the band took three presses, and each press closed
 * only the layer the reader was not looking at.
 *
 * A *click* outside keeps dismissing exactly one layer, and the difference is
 * deliberate: `stripDismiss.ts` explains why picking a card in the column must not
 * also end the reading session. A key press carries no such gesture behind it —
 * nothing is being picked, nothing is being typed — so taking everything away at
 * once loses nothing.
 *
 * Two surfaces are still left out, both because they hold text the reader is in
 * the middle of writing, and each of them cancels itself:
 *
 * - the markdown popup, which may be holding an unsaved note;
 * - a note field or the inline card editor, where Escape means "drop this edit".
 *
 * The detached notes window is not on the list either, and not for the same
 * reason: it is another window. Closing it docks the column *back into* the
 * viewer — the opposite of closing everything — so Escape in the main window
 * leaves it alone.
 *
 * The list lives here, apart from the app's DOM, so the rule can be read and
 * tested on its own; `App` supplies the flags and applies the result.
 */

/**
 * The overlays, innermost first. The order is part of the contract: the caller
 * applies the closes in it, so the menu it just opened is gone before the strip
 * it belongs to.
 */
export const ESCAPE_LAYERS = ["stripMenu", "search", "notesPanel", "band"] as const;

export type EscapeLayer = (typeof ESCAPE_LAYERS)[number];

/** Which overlays are open right now. */
export type OverlayState = Record<EscapeLayer, boolean>;

/** The overlays one Escape press closes: every one that is open, never just the top. */
export function closedByEscape(open: OverlayState): EscapeLayer[] {
  return ESCAPE_LAYERS.filter((layer) => open[layer]);
}
