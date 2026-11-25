/** Gap between the pointer and the preview, and the window edge it will not cross. */
const OFFSET_PX = 14;
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
 * Where the box sits so it opens from the pointer and stays on screen.
 *
 * Prefer the lower-right of the cursor. When that would leave the window, flip
 * to the other side of the pointer, then clamp so a page taller than the
 * window still starts inside it.
 */
export function placePagePreview(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number } {
  let left = x + OFFSET_PX;
  let top = y + OFFSET_PX;
  if (left + width > viewportWidth - MARGIN_PX) left = x - width - OFFSET_PX;
  if (top + height > viewportHeight - MARGIN_PX) top = y - height - OFFSET_PX;
  return clampPagePreview(left, top, width, height, viewportWidth, viewportHeight);
}
