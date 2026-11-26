/**
 * Where the pointer last was, for the keys that carry no coordinates.
 *
 * A key press names a key and nothing about place. `H`, though, means the same
 * thing a right-click on the page means — put the pen down on the line the
 * pointer is on — and a right-click knows its own point while a `keydown` does
 * not: the browser hands it no position. So the last pointer move is remembered
 * here and the key handler reads it back. One passive listener on the window,
 * the point in a module variable, no render for a move that changes nothing the
 * UI shows.
 *
 * The point is in viewport pixels — the space `MouseEvent` reports and the
 * space `brushUnderPoint` measures in — so a caller can hand it straight on.
 * Nothing here decides whether there is text at the point: that is the brush's
 * own question, asked when the pen arms, and the answer for bare paper is the
 * pen's usual thickness.
 */

export type PointerSpot = {
  /** Viewport pixels from the left edge. */
  x: number;
  /** Viewport pixels from the top edge. */
  y: number;
};

let spot: PointerSpot | null = null;

/** Remember a pointer position. The last one wins. */
export function rememberPointerSpot(x: number, y: number): void {
  spot = { x, y };
}

/**
 * Forget it.
 *
 * Called when the pointer leaves the document, so a key cannot measure a place
 * the pointer is no longer at — the page may have moved under it since.
 */
export function forgetPointerSpot(): void {
  spot = null;
}

/**
 * Where the pointer last was, or null when it has not been seen since the app
 * loaded.
 *
 * Null is not "no text there": it is "no position to ask about", and a caller
 * treats both the same way, with the pen's default brush.
 */
export function pointerSpot(): PointerSpot | null {
  return spot;
}

/**
 * Follow the pointer, and stop when the returned function is called.
 *
 * The viewer installs this once on mount. `pointerdown` is recorded too, because
 * a tap can press without a move first: the point is the same either way, and
 * the pen should not start at the default thickness just because the last thing
 * the pointer did was arrive.
 */
export function installPointerSpot(): () => void {
  if (typeof window === "undefined") return () => {};
  const record = (event: PointerEvent) => rememberPointerSpot(event.clientX, event.clientY);
  const leave = (event: PointerEvent) => {
    // A `pointerout` with no related target usually means the pointer left the
    // document. It is also what a released pointer capture and a touch ending
    // report, with the pointer still exactly where it was — so the remembered
    // point decides: no element under it means it is outside the window now.
    if (event.relatedTarget !== null) return;
    const at = spot;
    if (!at) return;
    if (typeof document !== "undefined" && document.elementFromPoint(at.x, at.y)) return;
    forgetPointerSpot();
  };
  window.addEventListener("pointermove", record, { passive: true });
  window.addEventListener("pointerdown", record, { passive: true });
  window.addEventListener("pointerout", leave, { passive: true });
  return () => {
    window.removeEventListener("pointermove", record);
    window.removeEventListener("pointerdown", record);
    window.removeEventListener("pointerout", leave);
  };
}
