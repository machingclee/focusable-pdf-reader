/**
 * The query string of a viewer window that was opened on its own.
 *
 * There are three of them, and they differ by what they name besides the
 * document:
 *
 * - A `[note:<id>]` reference names a note, and a note is a band of a page of a
 *   PDF. So "show me this note" means a viewer of its own: a window opened on
 *   that document in single page mode, notes column folded, with the reading
 *   strip parked on that strip — the same parked band the viewer shows when a
 *   card is clicked or a badge is double-clicked, in a window that is
 *   independent of whatever the reader was doing.
 * - An `[annotation:<id>]` reference names a piece of text pinned to a point on a
 *   page. The same kind of window, with nothing parked: the page is scrolled so
 *   that point sits on the reading line, a fifth of the way down — the place a
 *   saved strip's band would land.
 * - "Open PDF in new window" from the documents column names only the document:
 *   the same window, with nothing to stand on. It is a second reading of that
 *   PDF beside the one already on screen, so it opens like a window of its own
 *   and nothing is parked in it.
 *
 * A reference only *needs* a window of its own when no window has that document
 * open: a subwindow that does is told to stand on the passage instead, and shows
 * it exactly the way a window opened on it would (`ViewerEvent` in
 * `windowBridge.ts`, chosen by `openViewers.ts`). So this request is what a
 * reference viewer is *made* with, not what every reference click produces.
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
   * The note (strip) to put the reading strip on, or `null` when this window was
   * not opened on one.
   */
  noteId: number | null;
  /**
   * The annotation whose point the page is scrolled to, or `null`. A window names
   * one of the two at most: a passage is either a band of a page or a point on it.
   */
  annotationId: number | null;
};

/**
 * The request a viewer window was created with, or null in any other window.
 *
 * `view=viewer` is what tells the entry point to load the viewer rather than the
 * notes column (`view=notes`) or the ordinary main window (no `view` at all).
 * The document is required; the note or the annotation is what separates a
 * reference viewer from a document opened in a window of its own, so a malformed
 * one is refused rather than read as "nothing to stand on". A request that names
 * both is refused too: the window would have two places to go and no rule for
 * which one wins.
 */
export function parseViewerRequest(
  search = typeof window === "undefined" ? "" : window.location.search,
): ViewerRequest | null {
  const params = new URLSearchParams(search);
  if (params.get("view") !== "viewer") return null;

  const filePath = params.get("document");
  if (!filePath) return null;

  const rawNote = params.get("note");
  const rawAnnotation = params.get("annotation");
  if (rawNote !== null && rawAnnotation !== null) return null;

  const noteId = parsePassageId(rawNote);
  const annotationId = parsePassageId(rawAnnotation);
  if (noteId === false || annotationId === false) return null;

  return { filePath, noteId, annotationId };
}

/**
 * One `note=` / `annotation=` value, or `false` when it is not an id.
 *
 * Absent is `null` — the window simply is not about that kind of passage — while a
 * value that is present and wrong is a refusal: it was meant to name something and
 * the window cannot know what.
 */
function parsePassageId(raw: string | null): number | null | false {
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return false;
  const id = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(id) || id < 1) return false;
  return id;
}
