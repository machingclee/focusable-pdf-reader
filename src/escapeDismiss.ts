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
 * the middle of writing, and each of them cancels itself (the rule, and how it is
 * detected, are in `escapeKeptByEditor` below):
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

/**
 * The facts the rule below needs: what is open, and where the press started.
 */
export type EscapeOwnerFacts = {
  /** The markdown popup is mounted, whether or not it still has focus. */
  noteDialogOpen: boolean;
  /** The press started in an editable field inside the notes column. */
  typingInNotes: boolean;
};

/**
 * Whether one Escape press must *not* reach the viewer, even though the viewer
 * has overlays on screen.
 *
 * Two surfaces answer Escape themselves, because each holds text the reader is
 * in the middle of writing: the markdown popup (an unsaved note) and a note field
 * or the inline card editor (where Escape drops the edit). While either is up the
 * press is theirs, and the column and band behind them stay.
 *
 * The popup is decided by being **open**, not by where the press started. Asking
 * the event target worked while the caret was in the editor, but the popup's
 * preview pane takes no focus: click it, press Escape, and the target was the
 * page — so the viewer took the key and closed the popup *and* the column *and*
 * the reading band behind it, taking away the passage the note was written about
 * on a key the footer advertises as "cancel".
 */
export function escapeKeptByEditor({ noteDialogOpen, typingInNotes }: EscapeOwnerFacts): boolean {
  return noteDialogOpen || typingInNotes;
}
