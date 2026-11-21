/**
 * Which clicks turn the displayed reading strip off again.
 *
 * Focus mode is a mode, and the band is the whole of its surface: a click
 * anywhere else is the natural "stop reading like this" gesture, whether the
 * strip was double-clicked up, toggled with `F`, or opened from a saved card.
 *
 * A handful of surfaces have to keep receiving the click, though:
 *
 * - the band itself, because clicking or resizing it is not a dismissal;
 * - a note badge, because it is asking to show the remark it announces — opening
 *   the notes column is not the same as leaving focus mode;
 * - the band's menu, because the click that chooses **Save note** would
 *   otherwise dismiss before the menu could act;
 * - the toolbar, which is the strip's own console — the Focus toggle would
 *   dismiss and then toggle itself back on, and the Strip and Blur sliders are
 *   adjusted *while* the veil is on screen, so dismissing from there would make
 *   them unusable;
 * - the markdown note dialog, which is modal and closes on its own terms;
 * - the **Notes of this PDF** column, which is where the notes are read.
 *
 * The column is exempt rather than special. It is not dismissed by an outside
 * click at all — it closes from the toolbar, its own chord, Escape, or by being
 * dragged shut — so a click beside it is the page's, and the strip goes as it
 * always did. Inside it, a click is what picks a card or puts the caret in the
 * note field the strip was just saved into; ending the reading session there
 * would take the notes away from the passage they belong to.
 *
 * The trigger is a *click*, not a press, for two reasons. A press that turns
 * into a drag is not a click, so dragging the scrollbar while the strip rides
 * the page — the default Scroll lock — leaves the strip alone, and so does
 * selecting a sentence. And the second click of a double-click is left to the
 * app: the first click clears the old strip, the second parks the new one, so a
 * double-click elsewhere *moves* the strip rather than toggling it off.
 *
 * The rule lives here, apart from the app's DOM, so it can be read and tested on
 * its own: a "target" is anything that can answer `closest`, which is a DOM
 * element's job.
 */

/** Clicks inside any of these surfaces are passed through untouched. */
export const STRIP_DISMISS_EXEMPT = [
  ".focus-band",
  ".remark-marker",
  ".toolbar",
  ".strip-menu",
  ".note-backdrop",
  ".doc-notes",
] as const;

export type StripClick = {
  /** `MouseEvent.button`; only `0` is the left button. */
  button: number;
  /** `MouseEvent.detail`: the click count, so a double-click's second click is excluded. */
  clickCount: number;
  /** The clicked element, or null when the event's target is not an element. */
  target: { closest(selector: string): unknown } | null;
};

/**
 * True when this click should turn the strip off.
 *
 * The button comes first: the middle button pans the document under the strip and
 * the right button opens the band's menu, and neither is a dismissal. Then the
 * click count: 2 and up belong to the double-click that parks a strip. What is
 * left is a plain left click, and it dismisses unless it landed on a surface the
 * reader is using (see `STRIP_DISMISS_EXEMPT`).
 */
export function dismissesStrip({ button, clickCount, target }: StripClick): boolean {
  if (button !== 0) return false;
  if (clickCount > 1) return false;
  if (!target) return false;
  return !STRIP_DISMISS_EXEMPT.some((selector) => target.closest(selector) !== null);
}
