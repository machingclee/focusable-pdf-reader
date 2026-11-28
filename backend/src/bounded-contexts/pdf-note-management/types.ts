/**
 * The Prisma row types the PDF notes context works with.
 *
 * The context is intentionally bound to Prisma: Prisma Client is the
 * repository, so there is no separate repository layer. These aliases keep the
 * command/query result types readable at the call site.
 *
 * `DocumentTag` is the one type borrowed from the PDF tag context: a document
 * row carries its tags, and the two contexts meet at that published shape. The
 * pins and strokes painted on a document's pages are the markup context's rows,
 * and that context publishes their types; nothing here aliases them.
 */

import type {
  app_state,
  note,
  note_folder,
  pdf_document,
} from "../../generated/prisma/client.ts";
import type { DocumentTag } from "../pdf-tag-management/types.ts";

export type PdfDocument = pdf_document;
export type NoteFolder = note_folder;
export type Note = note;
export type AppStateRow = app_state;

/**
 * A strip as the API returns it.
 *
 * The columns are the row. `highlights` and `annotations` are the JSON lists
 * rebuilt from the document's rows for this strip's page: the marks its preview
 * multiplies into the paper, and the pins it draws on top of them. Both belong
 * to the document — a strip owns neither — but a card reads them as one list.
 */
export type StripResponse = note & { highlights: string; annotations: string };

/** The settings row the API returns. Columns, not the Prisma relation. */
export type AppState = {
  id: number;
  notes_panel_width: number | null;
  event_log_panel_width: number | null;
  notes_documents_width: number | null;
  last_opened_pdf_document_id: number | null;
  updated_at: number;
};

export type NoteFolderWithNotes = note_folder & { notes: StripResponse[] };

export type PdfDocumentWithNotes = pdf_document & {
  notes: StripResponse[];
};

export type PdfDocumentWithCount = pdf_document & {
  _count: { notes: number };
  tags: DocumentTag[];
};

export type NoteWithDocument = StripResponse & {
  pdf_document: { id: number; name: string; file_path: string };
};
