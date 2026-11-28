/**
 * Handing one document's notes to the browser.
 *
 * The half of the export that touches the outside world: a canvas per strip and
 * one command into the shell. The file's contents come from `notesHtml.ts`, and
 * this module supplies the one thing that module cannot: the strip pictures,
 * painted from the PDF.
 *
 * There is no save dialog and no chosen folder, on purpose. The export is a
 * reading copy — the app's notes, opened where they can be read, printed or
 * saved by the browser itself — so the shell writes it to a temporary file and
 * opens it (`write_and_open_html` in `src-tauri/src/lib.rs`). That keeps the
 * webview out of the filesystem and the reader out of a dialog they did not ask
 * for.
 *
 * The pictures are why the export is asynchronous. A note is text and renders
 * instantly; a strip is a band of a page, and a book-sized PDF costs a page
 * render per strip. A moved or deleted PDF must not lose the notes: if the
 * document cannot be opened, the export still happens, text only.
 */
import { invoke } from "@tauri-apps/api/core";
import { getPreviewDocument, renderStripBand } from "./notesPreview";
import { inlineNoteImages } from "./markdown/noteImages";
import { noteReferenceIds } from "./noteReference";
import { buildNotesHtml } from "./notesHtml";
import { paintAnnotationsOnPage, parseStripAnnotations } from "./annotation";
import { paintHighlightsOnPage, parseHighlights } from "./stripHighlight";
import type { Note, NoteFolderWithNotes } from "./types/dto";

/**
 * How wide a strip picture is painted, in painted pixels.
 *
 * The exported page shows a picture at about 700 CSS px — the width of its
 * reading column, inside the strip card — so one painted pixel per CSS pixel
 * (640 before this) was already soft on a retina screen and softer once printed:
 * the browser had nothing in reserve to spend on the extra device pixels or on
 * paper.
 *
 * Three pixels per displayed pixel fixes both at once. It is 2100 px for a column
 * that prints about 7 inches wide, which is roughly 300 dpi on paper, and a
 * retina screen downsamples the surplus away instead of inventing it. The cost is
 * a bigger file and a slower export (a page render scales with area), which is why
 * the button counts pictures as it goes.
 *
 * Only the picture grows: the page draws it at `width: 100%`, so the snapshot
 * looks the same size and is just sharper.
 */
const PICTURE_DISPLAY_WIDTH_PX = 700;
const PICTURE_PIXEL_DENSITY = 3;
const EXPORT_PICTURE_WIDTH = PICTURE_DISPLAY_WIDTH_PX * PICTURE_PIXEL_DENSITY;

export type ExportProgress = {
  /** Pictures painted so far. */
  done: number;
  total: number;
};

export type NotesExportRequest = {
  documentName: string;
  filePath: string;
  folders: NoteFolderWithNotes[];
  /** Strips in no folder, in their own order. */
  unfiled: Note[];
};

export type NotesExportResult = {
  /** Absolute path of the temporary file the browser was handed. */
  path: string;
  strips: number;
  pictures: number;
};

/**
 * Paint every strip's band and return them as PNG data URLs.
 *
 * Each picture is independent: one band that fails to render (a page the PDF no
 * longer has, say) is simply left out, and the note it belongs to still reads.
 */
async function renderPictures(
  filePath: string,
  strips: Note[],
  onProgress?: (progress: ExportProgress) => void,
): Promise<Map<number, string>> {
  const pictures = new Map<number, string>();
  if (strips.length === 0) return pictures;

  let pdf;
  try {
    pdf = await getPreviewDocument(filePath);
  } catch {
    // No document, no pictures: the notes are still worth exporting.
    return pictures;
  }

  let done = 0;
  for (const strip of strips) {
    const canvas = document.createElement("canvas");
    try {
      await renderStripBand(canvas, pdf, strip, EXPORT_PICTURE_WIDTH).promise;
      // The same yellow as the preview, flattened first so crossings stay one colour,
      // and then the pins that stand on that page.
      paintHighlightsOnPage(canvas, parseHighlights(strip.highlights), strip);
      paintAnnotationsOnPage(canvas, parseStripAnnotations(strip.annotations), strip);
      pictures.set(strip.id, canvas.toDataURL("image/png"));
    } catch {
      // One unreadable band is not an export failure.
    }
    done += 1;
    onProgress?.({ done, total: strips.length });
  }

  return pictures;
}

/**
 * Every strip whose picture the file actually shows.
 *
 * The list is the open cards. A folded card is painted only when an open note
 * points at it, because that is where the file draws it. A note already queued
 * is not painted twice, and a note that points back at one already on the way
 * down is not followed again.
 */
function stripsToPaint(notes: Note[]): Note[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const paint: Note[] = [];
  const seen = new Set<number>();

  const visit = (note: Note, chain: number[]) => {
    if (seen.has(note.id) || chain.includes(note.id)) return;
    seen.add(note.id);
    paint.push(note);
    for (const id of noteReferenceIds(note.remark)) {
      const target = byId.get(id);
      if (target) visit(target, [...chain, note.id]);
    }
  };

  for (const note of notes) {
    if (note.expanded !== false) visit(note, []);
  }
  return paint;
}

/**
 * Export one document's notes and open them in the browser.
 *
 * Throws when the file could not be written or opened — the one failure the
 * reader has to hear about, because nothing else in the request happened.
 */
export async function exportDocumentNotes(
  request: NotesExportRequest,
  options: { onProgress?: (progress: ExportProgress) => void; now?: () => number } = {},
): Promise<NotesExportResult> {
  // A folded card is not a strip of the file, and it is not counted as one. A
  // note that an open note points at is still drawn there, so its picture is
  // painted too — folded or not — without adding it to the count.
  const all = [...request.folders.flatMap((folder) => folder.notes), ...request.unfiled];
  const listed = all.filter((strip) => strip.expanded !== false);
  const pictures = await renderPictures(request.filePath, stripsToPaint(all), options.onProgress);
  // Pasted pictures are `images/<file>` in the remark. The browser that opens
  // this file cannot see that folder, so they are inlined before it is written.
  const html = await inlineNoteImages(
    buildNotesHtml({
      documentName: request.documentName,
      filePath: request.filePath,
      folders: request.folders,
      unfiled: request.unfiled,
      generatedAt: (options.now ?? Date.now)(),
      thumbnails: pictures,
    }),
  );

  const path = await invoke<string>("write_and_open_html", { html });
  return { path, strips: listed.length, pictures: pictures.size };
}
