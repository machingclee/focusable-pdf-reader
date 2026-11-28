/**
 * The Prisma row types the PDF markup context works with.
 *
 * The context is intentionally bound to Prisma: Prisma Client is the
 * repository, so there is no separate repository layer. These aliases keep the
 * command/query result types readable at the call site.
 *
 * A markup row is painted on a page of a document and belongs to that document.
 * It never belongs to a strip: a strip is a band of one page in the notes
 * context, and its preview only paints the rows drawn on that page.
 */

import type { annotation } from "../../generated/prisma/client.ts";

/** One saved pin. The row is the API's shape. */
export type Annotation = annotation;

/**
 * One annotation, with the document it belongs to.
 *
 * A `[annotation:<id>]` reference may be read in a note of another PDF, so the
 * row has to carry enough for the reader to be taken back: the document's name
 * to say where it is, and its path to open the viewer window on it.
 */
export type AnnotationWithDocument = annotation & {
  pdf_document: { id: number; name: string; file_path: string };
};

/**
 * An annotation exactly as history remembers it.
 *
 * The row is small and every column is needed to put it back, so a snapshot is
 * the row: restoring one writes the same id and the same `created_at`, and the
 * references that point at it keep working. The notes context carries this shape
 * on its `RestorePdfDocumentCommand`, which is why it is published here rather
 * than kept private to `annotation/rows.ts`.
 */
export type AnnotationSnapshot = Pick<
  annotation,
  "id" | "pdf_document_id" | "page_number" | "x" | "y" | "width" | "font_size" | "text" | "created_at"
>;
