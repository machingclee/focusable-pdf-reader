/**
 * What one Escape press closes.
 *
 * Escape steps back **one layer at a time**. While the reading strip is on, that
 * layer is the strip: it takes the key ahead of the event log, the band's menu,
 * the search bar and the notes column. A press turns the strip off and leaves
 * every other surface exactly where it was. The menu belongs to the strip, so it
 * goes with it on that same press rather than claiming one of its own.
 *
 * The strip is the thing the reader just turned on, and Escape is how they turn
 * it off (`F` and the Focus button do the same). A click beside the band does not
 * dismiss it (see the note in `App` where that listener used to be), so the key
 * is the way out that does not depend on aiming. Putting it last meant a press
 * while a column or the find field was open put that aside away and left the
 * strip up — the opposite of what the key is for once the strip is on.
 *
 * With the strip off, the remaining layers keep their own order: the event log,
 * then the band's menu, then the search bar, then the notes column. The log is
 * still a column watched *while* the viewer is used, so a press that finds it
 * open and the strip off closes the log and nothing else.
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
 * open. The reading strip is first, so a press while it is on turns it off before
 * it will close the log, the menu, the find field or the notes column.
 *
 * After the strip, the event log comes ahead of the menu and the search bar: it
 * is not an overlay at all but a column the reader raised to watch, and while the
 * strip is off Escape means "close the log" and nothing else.
 */
export const ESCAPE_LAYERS = ["band", "eventLog", "stripMenu", "search", "notesPanel"] as const;

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
