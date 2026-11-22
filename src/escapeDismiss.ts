/**
 * What one Escape press closes.
 *
 * Escape steps back **one layer at a time**, outermost first: the band's menu,
 * the search bar, the notes column, then the reading strip. A press takes away
 * the one thing the reader is most likely to be finished with and leaves the
 * rest exactly where it was.
 *
 * The reading strip comes last because it is the mode, not an overlay opened over
 * it: the column is an aside the reader raised *from* the passage they are
 * reading, so Escape closes the aside, and a second press — once the page has the
 * window back — leaves the mode. Closing both in one press used to be the rule,
 * on the reasoning that Escape means "get me out"; but the strip is where the
 * reader *is*, and a key that ends the reading session whenever a panel happens to
 * be open loses the place they were keeping. The menu is a choice not yet made
 * and the search bar is a field, so both go before either surface.
 *
 * The strip is, since that same outside-click listener was removed, reachable no
 * other way than this and its own controls: a click beside the band does not
 * dismiss it (see the note in `App` where the listener used to be), so the reader
 * who clicks in the veil to reach for a word above the hole keeps the strip they
 * were reading.
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
 * viewer — the opposite of stepping back — so Escape in the main window leaves it
 * alone.
 *
 * The list lives here, apart from the app's DOM, so the rule can be read and
 * tested on its own; `App` supplies the flags and applies the result.
 */

/**
 * The overlays in the order Escape closes them, one per press.
 *
 * The order is the whole contract: the caller closes only the first layer that is
 * open, so the menu a reader just opened goes before the band it belongs to, and
 * the notes column goes before the reading strip it was opened from.
 *
 * The event log comes first, ahead of even the menu and the search bar: it is not
 * an overlay at all but a column the reader raised to watch, and while it is up
 * Escape means "close the log" and nothing else. A press that also took the notes
 * column, or ended the reading session, or emptied the find field would move the
 * page out from under someone who asked only to put the log away.
 */
export const ESCAPE_LAYERS = ["eventLog", "stripMenu", "search", "notesPanel", "band"] as const;

export type EscapeLayer = (typeof ESCAPE_LAYERS)[number];

/** Which overlays are open right now. */
export type OverlayState = Record<EscapeLayer, boolean>;

/**
 * The one overlay this press closes: the first that is open in `ESCAPE_LAYERS`,
 * or `null` when nothing is (so the caller only claims the key when it answered).
 */
export function closedByEscape(open: OverlayState): EscapeLayer | null {
  return ESCAPE_LAYERS.find((layer) => open[layer]) ?? null;
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
 * Whether one Escape press must *not* reach the viewer at all, even though the
 * viewer has a layer on screen.
 *
 * Two surfaces answer Escape themselves, because each holds text the reader is
 * in the middle of writing: the markdown popup (an unsaved note) and a note field
 * or the inline card editor (where Escape drops the edit). While either is up the
 * press is theirs, and the layer behind them — the column that was raised, the
 * band that was being read — stays.
 *
 * The popup is decided by being **open**, not by where the press started. Asking
 * the event target worked while the caret was in the editor, but the popup's
 * preview pane takes no focus: click it, press Escape, and the target was the
 * page — so the viewer took the key and closed the column the note was being
 * written in, on a key the footer advertises as "cancel".
 */
export function escapeKeptByEditor({ noteDialogOpen, typingInNotes }: EscapeOwnerFacts): boolean {
  return noteDialogOpen || typingInNotes;
}
