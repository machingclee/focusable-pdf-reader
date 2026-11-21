/**
 * Ending a drag the window took away.
 *
 * Every pointer gesture in the viewer finishes on `pointerup` or `pointercancel`
 * delivered to the element that captured the pointer, and its cleanup — dropping
 * the drag's cursor class, detaching the move listener, putting the band back where
 * it belongs — hangs off that. A drag that is *interrupted* instead never delivers
 * either event: ⌘-Tab, another window taking focus, a native menu or dialog. The
 * cleanup then never runs, which the reader sees as a cursor that will not go back
 * (`grabbing`, `↕`) and, worse, as a move listener still attached, so the next
 * pointer move in this window keeps dragging from a press that was abandoned.
 *
 * Window `blur` is the one event that does arrive in that case, so it is where the
 * drag is ended. The returned function stops watching: call it from the cleanup
 * that ends the drag normally, so a finished drag does not leave a listener behind.
 *
 * Kept apart from `App` because it is about the window, not about any one gesture,
 * and every gesture in the viewer needs it.
 */
export function endDragOnBlur(end: () => void): () => void {
  const onBlur = () => end();
  window.addEventListener("blur", onBlur);
  return () => window.removeEventListener("blur", onBlur);
}
