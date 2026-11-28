import { highlightJson } from "../../pdf-markup-management/highlight/marks.ts";
import type { NoteFolder, PdfDocument } from "../types.ts";

/** One saved stroke, or the JSON list a snapshot already carries. */
type MarkSource = { x0: number; x1: number; y: number; size: number };

/**
 * A strip as history remembers it: the columns, plus the mark list.
 *
 * The list is not a column. Restoring a strip writes it back as `highlight`
 * rows, which is why the snapshot keeps it beside the columns.
 */
export type StripSnapshot = {
  id: number;
  pdf_document_id: number;
  note_folder_id: number | null;
  ordering: number;
  page_number: number;
  top: number;
  height: number;
  left: number;
  width: number;
  page_width: number;
  page_height: number;
  text_excerpt: string | null;
  remark: string;
  expanded: boolean;
  created_at: number;
  highlights: string;
};

type StripSource = Omit<StripSnapshot, "highlights"> & {
  highlights?: string | readonly MarkSource[];
};

/** The document columns, without a Prisma relation hanging off the row. */
export function plainDocument(document: PdfDocument): PdfDocument {
  return {
    id: document.id,
    name: document.name,
    file_path: document.file_path,
    fingerprint: document.fingerprint,
    page_count: document.page_count,
    content_hash: document.content_hash,
    original_path: document.original_path,
    ordering: document.ordering,
    created_at: document.created_at,
  };
}

/** The folder columns, without its strips. */
export function plainNoteFolder(folder: NoteFolder): NoteFolder {
  return {
    id: folder.id,
    pdf_document_id: folder.pdf_document_id,
    name: folder.name,
    ordering: folder.ordering,
    created_at: folder.created_at,
  };
}

/** The strip columns and its mark list, without its document or folder. */
export function plainStrip(strip: StripSource): StripSnapshot {
  const highlights = typeof strip.highlights === "string" ? strip.highlights : highlightJson(strip.highlights ?? []);
  return {
    id: strip.id,
    pdf_document_id: strip.pdf_document_id,
    note_folder_id: strip.note_folder_id,
    ordering: strip.ordering,
    page_number: strip.page_number,
    top: strip.top,
    height: strip.height,
    left: strip.left,
    width: strip.width,
    page_width: strip.page_width,
    page_height: strip.page_height,
    text_excerpt: strip.text_excerpt,
    remark: strip.remark,
    expanded: strip.expanded,
    created_at: strip.created_at,
    highlights,
  };
}

/**
 * Columns of a strip snapshot, without the mark list the document holds.
 *
 * The marks are rows in the markup context, not a column of `note`, so a replay
 * writes them back through that context's `replaceDocumentHighlights` and the
 * `note.create` here must not be handed the list.
 */
export function stripColumns<T extends { highlights?: string | readonly MarkSource[] }>(
  strip: T,
): Omit<T, "highlights"> {
  const { highlights: _marks, ...columns } = strip;
  return columns;
}
