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
  file_path: string;
  /** pdf.js fingerprint, used to re-link a moved file. */
  fingerprint: string | null;
  page_count: number | null;
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
  /** Unix epoch milliseconds. */
  created_at: number;
  /** Only present on `/focusable-strips` responses. */
  pdf_document?: { id: number; name: string; file_path: string };
};

export type PdfDocumentWithStrips = PdfDocument & { focusable_strips: FocusableStrip[] };

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
};

/** One remembered UI value, as `PUT /app-state/:key` answers it. */
export type AppStateEntry = {
  key: string;
  value: string;
  updated_at: number;
};
