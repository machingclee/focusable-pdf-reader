/**
 * The Prisma row types the PDF tag context works with.
 *
 * The context is intentionally bound to Prisma, like the notes context: Prisma
 * Client is the repository, so there is no separate repository layer. These
 * aliases keep the command/query result types readable at the call site.
 */

import type {
  assigned_pdf_tag,
  pdf_tag,
  pdf_tag_folder,
  rel_pdf_document_assigned_pdf_tag,
} from "../../generated/prisma/client.ts";

export type PdfTagFolder = pdf_tag_folder;
export type PdfTag = pdf_tag;
export type AssignedPdfTag = assigned_pdf_tag;
export type RelPdfDocumentAssignedPdfTag = rel_pdf_document_assigned_pdf_tag;

/** A tag as the catalogue lists it: the row plus how many documents carry it. */
export type PdfTagWithCount = pdf_tag & { document_count: number };

/** A document's tag, as the document list carries it. */
export type DocumentTag = { id: number; name: string; pdf_tag_folder_id: number | null };
