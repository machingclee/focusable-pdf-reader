/**
 * Putting one card on the notes list's line.
 *
 * Clicking a note badge asks for one strip, and the answer has to be *visible*
 * rather than merely scrolled into view: the card is placed a fifth of the way
 * down the list — the same line the reading strip lands on in the viewer — so the
 * note is read with the rest of the list below it instead of hugging the top
 * edge, which reads like a search result rather than a place in the notes.
 *
 * The awkward case is a card near the end of the list: the content below it is
 * shorter than four fifths of the viewport, so the line cannot be reached and the
 * list stops at its own end. That is the fallback, not a failure — the card is on
 * screen either way, and it is the selected one.
 *
 * Pure, so both cases can be tested without a scroller.
 */

/** Where the card's top edge lands: a fifth of the way down the list. */
export const CARD_LINE_FRACTION = 1 / 5;

export type CardScrollInput = {
  /** The card's top edge, in the scroller's scrollable content space. */
  cardTop: number;
  /** The scroller's visible height, in px. */
  viewportHeight: number;
  /** The largest offset the scroller accepts: content height minus viewport. */
  maxScrollTop: number;
  /**
   * Where on the viewport the card should land, as a fraction of its height. The
   * list passes `CARD_LINE_FRACTION`; it is an input because the maths does not
   * care which line it is handed.
   */
  lineFraction?: number;
};

/**
 * The offset to write to the scroller.
 *
 * Clamped at both ends, which is what turns "cannot reach the line" into "scroll
 * to the bottom": a card near the end lands at `maxScrollTop` and stays visible
 * there, and a card near the top lands at 0 rather than scrolling past the start.
 */
export function cardScrollTop(input: CardScrollInput): number {
  const fraction = input.lineFraction ?? CARD_LINE_FRACTION;
  const wanted = input.cardTop - input.viewportHeight * fraction;
  return Math.min(Math.max(wanted, 0), Math.max(0, input.maxScrollTop));
}
