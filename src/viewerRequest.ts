/**
 * The query string of a viewer window that was opened on its own.
 *
 * There are two of them, and they differ by one field:
 *
 * - A `[note:<id>]` reference names a note, and a note is a band of a page of a
 *   PDF. So "show me this note" means a viewer of its own: a window opened on
 *   that document, with the reading strip parked on that strip — the same parked
 *   band the viewer shows when a card is clicked or a badge is double-clicked, in
 *   a window that is independent of whatever the reader was doing.
 * - "Open PDF in new window" from the documents column names only the document:
 *   the same window, with no note to stand on. It is a second reading of that
 *   PDF beside the one already on screen, so it opens like a window of its own
 *   and nothing is parked in it.
 *
 * The window is the app's own viewer (`App`), so the request travels in the URL
 * it was created with rather than through the bridge: there is no shared context
 * to keep in step, because there is no "current document" other than the one the
 * window was opened for.
 *
 * Pure and DOM-free, so the parsing can be asserted in a test.
 */
export type ViewerRequest = {
  /** The document's library path, as the backend stores it. */
  filePath: string;
  /**
   * The note (strip) to put the reading strip on, or `null` for a window that
   * was opened on the document alone.
   */
  noteId: number | null;
};

/**
 * The request a viewer window was created with, or null in any other window.
 *
 * `view=viewer` is what tells the entry point to load the viewer rather than the
 * notes column (`view=notes`) or the ordinary main window (no `view` at all).
 * The document is required; the note is what separates a reference viewer from a
 * document opened in a window of its own, so a malformed one is refused rather
 * than read as "no note".
 */
export function parseViewerRequest(
  search = typeof window === "undefined" ? "" : window.location.search,
): ViewerRequest | null {
  const params = new URLSearchParams(search);
  if (params.get("view") !== "viewer") return null;

  const filePath = params.get("document");
  if (!filePath) return null;

  const raw = params.get("note");
  if (raw === null) return { filePath, noteId: null };
  if (!/^\d+$/.test(raw)) return null;
  const noteId = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(noteId) || noteId < 1) return null;

  return { filePath, noteId };
}
