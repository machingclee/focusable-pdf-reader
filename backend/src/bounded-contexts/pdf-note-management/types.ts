/**
 * The Prisma row types the PDF notes context works with.
 *
 * The context is intentionally bound to Prisma: Prisma Client is the
 * repository, so there is no separate repository layer. These aliases keep the
 * command/query result types readable at the call site.
 */

import type {
  app_state,
  focusable_strip,
  folder,
  pdf_document,
} from "../../generated/prisma/client.ts";

export type PdfDocument = pdf_document;
export type Folder = folder;
export type FocusableStrip = focusable_strip;
export type AppStateRow = app_state;

export type FolderWithStrips = folder & { focusable_strips: focusable_strip[] };

export type PdfDocumentWithStrips = pdf_document & {
  focusable_strips: focusable_strip[];
};

export type PdfDocumentWithCount = pdf_document & {
  _count: { focusable_strips: number };
};

export type FocusableStripWithDocument = focusable_strip & {
  pdf_document: { id: number; name: string; file_path: string };
};
