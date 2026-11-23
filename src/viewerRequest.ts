/**
 * The query string of a reference viewer window.
 *
 * A `[note:<id>]` reference names a note, and a note is a band of a page of a
 * PDF. So "show me this note" means a viewer of its own: a window opened on that
 * document, with the reading strip parked on that strip — the same parked band
 * the viewer shows when a card is clicked or a badge is double-clicked, in a
 * window that is independent of whatever the reader was doing.
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
  /** The note (strip) to put the reading strip on. */
  noteId: number;
};

/**
 * The request a reference viewer window was created with, or null in any other
 * window.
 *
 * `view=viewer` is what tells the entry point to load the viewer rather than the
 * notes column (`view=notes`) or the ordinary main window (no `view` at all).
 */
export function parseViewerRequest(
  search = typeof window === "undefined" ? "" : window.location.search,
): ViewerRequest | null {
  const params = new URLSearchParams(search);
  if (params.get("view") !== "viewer") return null;

  const filePath = params.get("document");
  if (!filePath) return null;

  const raw = params.get("note");
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const noteId = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(noteId) || noteId < 1) return null;

  return { filePath, noteId };
}
