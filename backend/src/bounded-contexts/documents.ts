/**
 * Document helpers shared by the resolve/import/rename handlers.
 *
 * The context is bound to Prisma, so these helpers take the transaction-scoped
 * client directly. The notes service is passed in rather than imported as a
 * static holder, so the handler that injects it is also the one that hands it
 * over.
 */

import type { pdf_document, Prisma } from "../generated/prisma/client.ts";
import type { PdfNotesService } from "./pdf-note-management/service/PdfNotesService.ts";

/**
 * A document with every strip it owns, in the order the viewer draws them:
 * folders in drag order, then the strips that are in no folder.
 */
export async function withStrips(
  db: Prisma.TransactionClient,
  document: pdf_document,
  notes: PdfNotesService,
) {
  const folders = await notes.listFoldersWithStrips(db, document.id);
  return {
    ...document,
    focusable_strips: [
      ...folders.flatMap((folder) => folder.focusable_strips),
      ...(await notes.listUnfiledStrips(db, document.id)),
    ],
  };
}

/** Last path segment without its extension, used when the client sends no name. */
export function defaultNameFor(file_path: string): string {
  const fileName = file_path.split(/[\\/]/).pop() ?? file_path;
  const dotIndex = fileName.lastIndexOf(".");
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  return stem.length > 0 ? stem : fileName;
}
