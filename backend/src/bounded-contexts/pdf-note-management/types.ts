/**
 * The Prisma row types the PDF notes context works with.
 *
 * The context is intentionally bound to Prisma: Prisma Client is the
 * repository, so there is no separate repository layer. These aliases keep the
 * command/query result types readable at the call site.
 */

import type {
  app_state,
  assigned_pdf_tag,
  focusable_strip,
  folder,
  pdf_document,
  pdf_tag,
  pdf_tag_folder,
  rel_pdf_document_assigned_pdf_tag,
} from "../../generated/prisma/client.ts";

export type PdfDocument = pdf_document;
export type Folder = folder;
export type FocusableStrip = focusable_strip;
export type AppStateRow = app_state;
export type PdfTagFolder = pdf_tag_folder;
export type PdfTag = pdf_tag;
export type AssignedPdfTag = assigned_pdf_tag;
export type RelPdfDocumentAssignedPdfTag = rel_pdf_document_assigned_pdf_tag;

/** A tag as the catalogue lists it: the row plus how many documents carry it. */
export type PdfTagWithCount = pdf_tag & { document_count: number };

/** A document's tag, as the document list carries it. */
export type DocumentTag = { id: number; name: string; pdf_tag_folder_id: number | null };

/**
 * A strip as the API returns it.
 *
 * The columns are the row. `highlights` is the JSON list rebuilt from the
 * `highlight` rows the strip owns, so a reader still receives one list.
 */
export type StripResponse = focusable_strip & { highlights: string };

/** The settings row the API returns. Columns, not the Prisma relation. */
export type AppState = {
  id: number;
  notes_panel_width: number | null;
  event_log_panel_width: number | null;
  notes_documents_width: number | null;
  last_opened_pdf_document_id: number | null;
  updated_at: number;
};

export type FolderWithStrips = folder & { focusable_strips: StripResponse[] };

export type PdfDocumentWithStrips = pdf_document & {
  focusable_strips: StripResponse[];
};

export type PdfDocumentWithCount = pdf_document & {
  _count: { focusable_strips: number };
  tags: DocumentTag[];
};

export type FocusableStripWithDocument = StripResponse & {
  pdf_document: { id: number; name: string; file_path: string };
};
