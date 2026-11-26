/** The window edge the card will not cross. */
const MARGIN_PX = 8;

/**
 * A box brought back inside the window.
 *
 * The second half of `placePagePreview`, and on its own for a box that is already
 * positioned: once the pointer is on it the card must not jump to the other side
 * of the cursor, but a page of another shape can still make it too big for the
 * place it was given.
 */
export function clampPagePreview(
  left: number,
  top: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number } {
  return {
    left: Math.min(Math.max(MARGIN_PX, left), Math.max(MARGIN_PX, viewportWidth - width - MARGIN_PX)),
    top: Math.min(Math.max(MARGIN_PX, top), Math.max(MARGIN_PX, viewportHeight - height - MARGIN_PX)),
  };
}

/**
 * Where the box sits so its corner is the thumbnail it was opened from.
 *
 * `x` and `y` are the card's corner, just clear of the thumbnail. It keeps them, and only slides
 * when it would leave the window — a tall page still starts inside the screen.
 */
export function placePagePreview(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number } {
  return clampPagePreview(x, y, width, height, viewportWidth, viewportHeight);
}
