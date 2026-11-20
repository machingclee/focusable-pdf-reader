/**
 * Which clicks turn the displayed reading strip off again.
 *
 * Focus mode is a mode, and the band is the whole of its surface: a click
 * anywhere else is the natural "stop reading like this" gesture, whether the
 * strip was double-clicked up, toggled with `F`, or opened from a saved card.
 *
 * A handful of surfaces have to keep receiving the click, though:
 *
 * - the band itself, because clicking (or dragging, or resizing) it is not a
 *   dismissal;
 * - a note badge, because it is asking to show the remark it announces — opening
 *   the notes column is not the same as leaving focus mode;
 * - the band's menu, because the click that chooses **Save strip** would
 *   otherwise dismiss before the menu could act;
 * - the toolbar, which is the strip's own console — the Focus toggle would
 *   dismiss and then toggle itself back on, and the Strip and Blur sliders are
 *   adjusted *while* the veil is on screen, so dismissing from there would make
 *   them unusable;
 * - the markdown note dialog, which is modal and closes on its own terms.
 *
 * The trigger is a *click*, not a press, for two reasons. A press that turns
 * into a drag is not a click, so dragging the scrollbar while the strip rides
 * the page — the default Scroll lock — leaves the strip alone, and so does
 * selecting a sentence. And the second click of a double-click is left to the
 * app: the first click clears the old strip, the second parks the new one, so a
 * double-click elsewhere *moves* the strip rather than toggling it off.
 *
 * The **Notes of this PDF** column outranks the strip, though. It is a layer
 * above the page with its own outside-click dismissal (on the press, in `App`),
 * so while it is in the way an outside click closes the column and nothing else:
 * turning the strip off at the same time would take two things away with one
 * gesture, and the click that picks a card — or puts the caret in the note field
 * the strip was just saved into — would end the reading session it belongs to.
 * Close the column and the next click outside the band dismisses the strip as
 * before.
 *
 * "In the way" is a state, not a DOM lookup, because the two dismissals fire at
 * different moments of the same gesture: the column closes on the press, the
 * strip on the click that follows. The caller passes whether the column owned
 * the gesture — open now, or open when the press began — which is why it belongs
 * in a parameter rather than in the target.
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
] as const;

export type StripClick = {
  /** `MouseEvent.button`; only `0` is the left button. */
  button: number;
  /** `MouseEvent.detail`: the click count, so a double-click's second click is excluded. */
  clickCount: number;
  /** The clicked element, or null when the event's target is not an element. */
  target: { closest(selector: string): unknown } | null;
};

/** The rest of the screen state the answer depends on. */
export type StripDismissContext = {
  /**
   * Whether the **Notes of this PDF** column takes this click: it is open, or it
   * was open when the press began and closed on it. Either way the column owns
   * the gesture and the strip stays where it is.
   */
  notesPanelOpen: boolean;
};

/**
 * True when this click should turn the strip off.
 *
 * The column comes first: it sits on top of the page, so while it is in the way
 * the click is its to handle, whatever it landed on. Then the button: the middle
 * button pans the document under the strip and the right button opens the
 * band's menu, and neither is a dismissal. Then the click count: 2 and up
 * belong to the double-click that parks a strip.
 */
export function dismissesStrip(
  { button, clickCount, target }: StripClick,
  { notesPanelOpen }: StripDismissContext,
): boolean {
  if (notesPanelOpen) return false;
  if (button !== 0) return false;
  if (clickCount > 1) return false;
  if (!target) return false;
  return !STRIP_DISMISS_EXEMPT.some((selector) => target.closest(selector) !== null);
}
