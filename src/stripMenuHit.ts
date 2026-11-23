/**
 * Whether a right-click opens the reading strip's menu.
 *
 * The hole lets the press through, so the page text under it can be selected
 * and the event's target is that text rather than the band. The menu is
 * therefore decided from where the pointer is. A control that already owns the
 * click — a note badge, the search field — keeps it.
 */

export type HoleRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function readingHoleTakesContextMenu(input: {
  /** Focus mode is on and the hole is drawn. */
  focusOn: boolean;
  x: number;
  y: number;
  /** The hole in viewport px, or null when it is not on screen. */
  hole: HoleRect | null;
  /** The press landed on a control that answers a right-click itself. */
  ownedByControl: boolean;
}): boolean {
  if (!input.focusOn || input.ownedByControl || input.hole === null) return false;
  const { left, top, right, bottom } = input.hole;
  return input.x >= left && input.x <= right && input.y >= top && input.y <= bottom;
}
