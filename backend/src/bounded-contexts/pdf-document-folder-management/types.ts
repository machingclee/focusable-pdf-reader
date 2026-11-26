/**
 * The Prisma row types the document-folder context works with, and the shape
 * the list returns: a folder plus the documents filed in it, in drag order.
 */

import type {
  pdf_document_folder,
  rel_pdf_document_folder_pdf_document,
} from "../../generated/prisma/client.ts";

export type PdfDocumentFolder = pdf_document_folder;
export type PdfDocumentFolderMembership = rel_pdf_document_folder_pdf_document;

/** A document folder as the rail lists it. `name_lower` stays in the database. */
export type PdfDocumentFolderView = {
  id: number;
  name: string;
  ordering: number;
  created_at: number;
  pdf_document_ids: number[];
  document_count: number;
};
