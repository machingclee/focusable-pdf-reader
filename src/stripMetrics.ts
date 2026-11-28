/**
 * The strip's own units.
 *
 * A strip is stored in PDF points and drawn in CSS pixels, and the two differ by
 * exactly the zoom: at 100% one point is one pixel. Every key that sizes the band
 * — `[` / `]` and its modifiers — moves it by `STRIP_STEP` points, and the band's
 * handlers convert with `stripScreenPx`.
 */

/** One `[` / `]` step, in PDF points. */
export const STRIP_STEP = 12;

/** On-screen CSS px for a strip measured in PDF points (1pt = 1px at 100% zoom). */
export function stripScreenPx(pt: number, zoom: number): number {
  return pt * zoom;
}
