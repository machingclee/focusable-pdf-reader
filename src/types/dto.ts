/**
 * The backend's data shapes.
 *
 * Moved out of the old `api.ts` client and kept free of any transport code: the
 * RTK Query slices, the components and the tests all read these, and nothing
 * here knows how a request is made.
 */

export type PdfDocument = {
  id: number;
  name: string;
  /**
   * The app's own copy of the file: `library/<sha256>.pdf` under the app data
   * folder. This is what the app reads, so the original may move or go away.
   */
  file_path: string;
  /** pdf.js fingerprint of the file, recorded when it was opened. */
  fingerprint: string | null;
  page_count: number | null;
  /** sha256 of the PDF; null for a document whose file was never copied into the library. */
  content_hash: string | null;
  /** Where the PDF was imported from. Display only. */
  original_path: string | null;
  /** Position in the notes document list. 0 is first. */
  ordering: number;
  /** Unix epoch milliseconds. */
  created_at: number;
};

export type Folder = {
  id: number;
  pdf_document_id: number;
  name: string;
  /** Position among the document's folders. 0 is first. */
  ordering: number;
  /** Unix epoch milliseconds. */
  created_at: number;
};

export type FolderWithStrips = Folder & { focusable_strips: FocusableStrip[] };

export type FocusableStrip = {
  id: number;
  /** The document it belongs to, which survives leaving every folder. */
  pdf_document_id: number;
  /** The folder it sits in, or null when it sits in none. */
  folder_id: number | null;
  /** Position among the strips that share its home: a folder, or no folder. */
  ordering: number;
  /** 1-based, same as `data-page` in the viewer. */
  page_number: number;
  /** Page-local position in PDF points, so zoom does not matter. */
  top: number;
  height: number;
  left: number;
  width: number;
  page_width: number;
  page_height: number;
  /** First ~200 characters: list label and backup locator. */
  text_excerpt: string | null;
  /** Markdown. */
  remark: string;
  /**
   * JSON list of yellow marks on the preview. Each mark is `{ x0, x1, y, size }`
   * in PDF points: the horizontal ends, the top edge from the top of the page,
   * and the thickness. `"[]"` when the preview is unmarked.
   */
  highlights: string;
  /** Unix epoch milliseconds. */
  created_at: number;
  /** Only present on `/focusable-strips` responses. */
  pdf_document?: { id: number; name: string; file_path: string };
};

export type PdfDocumentWithStrips = PdfDocument & { focusable_strips: FocusableStrip[] };

/**
 * A strip that names its document, as both `GET /focusable-strips` and
 * `GET /focusable-strips/:id` answer it. The nested card a `[note:<id>]`
 * reference renders needs the document's name and file: the note it points at
 * may live in another PDF, and the card paints that strip's band.
 */
export type FocusableStripWithDocument = FocusableStrip & {
  pdf_document: { id: number; name: string; file_path: string };
};

export type PdfDocumentListItem = PdfDocument & { _count?: { focusable_strips: number } };

export type HealthResponse = {
  status: string;
  pid: number;
  uptimeSeconds: number;
};

export type ResolveDocumentInput = {
  file_path: string;
  /** Defaults to the file name without its extension, on first resolve. */
  name?: string;
  fingerprint?: string;
  page_count?: number;
  /**
   * Write `name` over an existing document's name. Leave false so a name the
   * user edited is not reset to the file name every time the file is opened.
   */
  update_name?: boolean;
};

/**
 * `POST /pdf-documents/import`: the app's own copies of the PDFs the reader picked.
 *
 * The answer is one document per path, in the same order. Each `file_path` is
 * the library copy the viewer then reads.
 */
export type ImportDocumentInput = {
  source_paths: string[];
  /** Only used when one path is sent and that copy is new. */
  name?: string;
};

export type NewStripInput = {
  pdf_document_id: number;
  /** Omit to append the strip to the document's first folder. */
  folder_id?: number;
  page_number: number;
  top: number;
  height: number;
  left: number;
  width: number;
  page_width: number;
  page_height: number;
  text_excerpt?: string;
  remark?: string;
};

export type StripFilter = {
  pdf_document_id?: number;
  page_number?: number;
  /** Only the strips that are in no folder. */
  unfiled?: boolean;
};

/**
 * `PATCH /focusable-strips/:id`: every field a write may change, and only those
 * it was given. A resize moves the row without touching its note; a note edit
 * saves without resending the geometry.
 */
export type UpdateStripInput = {
  id: number;
  page_number?: number;
  top?: number;
  height?: number;
  left?: number;
  width?: number;
  page_width?: number;
  page_height?: number;
  /** Null when the band covers no text, which is a real state (a gap, a scan). */
  text_excerpt?: string | null;
  remark?: string;
  /** The preview's whole mark list, as JSON. Replaces whatever was stored. */
  highlights?: string;
};

/** The one settings row, as `GET /app-state` answers it. A null column is unset. */
export type AppState = {
  id: number;
  notes_panel_width: number | null;
  event_log_panel_width: number | null;
  /** Width of the Documents rail in the Notes tab, in CSS px. */
  notes_documents_width: number | null;
  last_opened_pdf_document_id: number | null;
  updated_at: number;
};

/** `PATCH /app-state` writes only the columns it names. */
export type UpdateAppStateInput = {
  notes_panel_width?: number;
  event_log_panel_width?: number;
  notes_documents_width?: number;
  last_opened_pdf_document_id?: number | null;
};
