/**
 * The annotations a document owns.
 *
 * A pin is one row on a page of the PDF: the text the reader wrote, and where on
 * that page it stands, in PDF points. Callers that speak a strip hand over the
 * JSON list of `{ id, x, y, text }` for that strip's page — a strip is a band of
 * one page, so its preview paints that page's pins and nothing else. The
 * document itself speaks whole rows, id included, because a reference in a note
 * names a row (`[annotation:<id>]`) rather than a copy of the text.
 *
 * The id matters twice here: a markdown reference resolves through it, and a
 * history replay has to put a deleted row back under it — otherwise every
 * `[annotation:<id>]` already pasted into a note would point at nothing.
 *
 * The rows belong to the markup context. The notes context paints a page's pins
 * on a card through the reads here, and stores none of them.
 */
import type { annotation, Prisma } from "../../../generated/prisma/client.ts";
import type { AnnotationSnapshot } from "../types.ts";

/** One saved pin, as a strip's preview receives it. The page is the strip's. */
export type StripAnnotation = Pick<
  annotation,
  "id" | "x" | "y" | "width" | "font_size" | "text"
>;

/** The JSON list the API hands a strip: its page's pins, id included. */
export function annotationJson(rows: readonly StripAnnotation[]): string {
  return JSON.stringify(
    rows.map(({ id, x, y, width, font_size, text }) => ({ id, x, y, width, font_size, text })),
  );
}

/** Every annotation of one document, oldest first. */
export async function loadDocumentAnnotations(
  db: Prisma.TransactionClient,
  pdfDocumentId: number,
): Promise<annotation[]> {
  return db.annotation.findMany({
    where: { pdf_document_id: pdfDocumentId },
    orderBy: { id: "asc" },
  });
}

/**
 * A document's annotations, grouped by `documentId:page`.
 *
 * One query for every document the caller is presenting, so a list of strips
 * costs one read rather than one per card.
 */
export async function annotationsByPage(
  db: Prisma.TransactionClient,
  documentIds: readonly number[],
): Promise<Map<string, StripAnnotation[]>> {
  const rows =
    documentIds.length === 0
      ? []
      : await db.annotation.findMany({
          where: { pdf_document_id: { in: [...documentIds] } },
          orderBy: { id: "asc" },
        });
  const byPage = new Map<string, StripAnnotation[]>();
  for (const row of rows) {
    const key = `${row.pdf_document_id}:${row.page_number}`;
    const list = byPage.get(key) ?? [];
    list.push({
      id: row.id,
      x: row.x,
      y: row.y,
      width: row.width,
      font_size: row.font_size,
      text: row.text,
    });
    byPage.set(key, list);
  }
  return byPage;
}

/**
 * Replace every annotation of a document, ids included.
 *
 * Undo of a delete, and the document half of restoring a deleted PDF. A write
 * that changes no row — a document with no annotations restored onto a document
 * that has none — is one `deleteMany` and nothing else.
 *
 * Every column the snapshot carries is written back, the width and the type size
 * included: a pin restored at the defaults would be a different annotation from the
 * one that was deleted, and the reader would have to resize it again.
 */
export async function replaceDocumentAnnotations(
  db: Prisma.TransactionClient,
  pdfDocumentId: number,
  rows: readonly AnnotationSnapshot[],
): Promise<void> {
  await db.annotation.deleteMany({ where: { pdf_document_id: pdfDocumentId } });
  if (rows.length === 0) return;
  await db.annotation.createMany({
    data: rows.map((row) => ({
      id: row.id,
      pdf_document_id: pdfDocumentId,
      page_number: row.page_number,
      x: row.x,
      y: row.y,
      width: row.width,
      font_size: row.font_size,
      text: row.text,
      created_at: row.created_at,
    })),
  });
}
