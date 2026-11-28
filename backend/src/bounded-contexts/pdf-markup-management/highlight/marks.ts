/**
 * The marks a document owns.
 *
 * A stroke is one row on a page of the PDF. Callers that still speak a strip
 * hand over the JSON list of `{ x0, x1, y, size }` for that strip's page: a
 * write replaces every mark on the page, and a read builds the same list back.
 * The document itself speaks `{ page, x0, x1, y, size }` for every page at once.
 *
 * Everything here belongs to the markup context, and `presentPages` is the read
 * the notes context calls. A row is owned by a document, never by a strip: the
 * notes context may paint a page's marks on a card, but it does not store them.
 */
import type { highlight, Prisma } from "../../../generated/prisma/client.ts";
import { annotationJson, annotationsByPage } from "../annotation/rows.ts";

export type HighlightMark = { x0: number; x1: number; y: number; size: number };
export type DocumentMark = HighlightMark & { page: number };

type MarkRow = Pick<highlight, "pdf_document_id" | "page_number" | "x0" | "x1" | "y" | "size">;

/** The JSON list a strip's page paints: no page number, the strip already has one. */
export function highlightJson(rows: readonly HighlightMark[]): string {
  return JSON.stringify(rows.map(({ x0, x1, y, size }) => ({ x0, x1, y, size })));
}

/** The JSON list of a whole document, page included. */
export function documentHighlightJson(rows: readonly DocumentMark[]): string {
  return JSON.stringify(rows.map(({ page, x0, x1, y, size }) => ({ page, x0, x1, y, size })));
}

function asMark(row: MarkRow): HighlightMark {
  return { x0: row.x0, x1: row.x1, y: row.y, size: row.size };
}

/** Every stroke of one document, oldest first. */
export async function loadDocumentMarks(
  db: Prisma.TransactionClient,
  pdfDocumentId: number,
): Promise<DocumentMark[]> {
  const rows = await db.highlight.findMany({
    where: { pdf_document_id: pdfDocumentId },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => ({ page: row.page_number, ...asMark(row) }));
}

/**
 * Every stroke on one page of one document, oldest first.
 *
 * The page is the unit a preview paints, so a caller that shows one page — a
 * strip in the notes context, today — reads exactly the rows it draws rather
 * than a document's marks and a filter of its own.
 */
export async function loadPageMarks(
  db: Prisma.TransactionClient,
  pdfDocumentId: number,
  pageNumber: number,
): Promise<DocumentMark[]> {
  const rows = await db.highlight.findMany({
    where: { pdf_document_id: pdfDocumentId, page_number: pageNumber },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => ({ page: row.page_number, ...asMark(row) }));
}

/**
 * Replace one page's marks.
 *
 * The strip command still sends the page's list. Marks on other pages stay.
 */
export async function replaceHighlights(
  db: Prisma.TransactionClient,
  stripId: number,
  raw: string,
): Promise<void> {
  const strip = await db.note.findUnique({
    where: { id: stripId },
    select: { pdf_document_id: true, page_number: true },
  });
  if (!strip) return;
  const marks = JSON.parse(raw) as HighlightMark[];
  await db.highlight.deleteMany({
    where: { pdf_document_id: strip.pdf_document_id, page_number: strip.page_number },
  });
  if (marks.length === 0) return;
  const created_at = Date.now();
  await db.highlight.createMany({
    data: marks.map((mark) => ({
      pdf_document_id: strip.pdf_document_id,
      page_number: strip.page_number,
      x0: mark.x0,
      x1: mark.x1,
      y: mark.y,
      size: mark.size,
      created_at,
    })),
  });
}

/** Replace every mark of a document. An empty list leaves the PDF unmarked. */
export async function replaceDocumentHighlights(
  db: Prisma.TransactionClient,
  pdfDocumentId: number,
  raw: string,
): Promise<void> {
  const marks = JSON.parse(raw) as DocumentMark[];
  await db.highlight.deleteMany({ where: { pdf_document_id: pdfDocumentId } });
  if (marks.length === 0) return;
  const created_at = Date.now();
  await db.highlight.createMany({
    data: marks.map((mark) => ({
      pdf_document_id: pdfDocumentId,
      page_number: mark.page,
      x0: mark.x0,
      x1: mark.x1,
      y: mark.y,
      size: mark.size,
      created_at,
    })),
  });
}

/**
 * Put each page-anchored row's marks back into the JSON lists the API returns.
 *
 * This is the one read another context calls: the notes context presents a
 * strip by handing over its pages, and gets back the same rows with the two
 * lists a preview paints attached. The rows themselves live on the document. A
 * strip on page 3 is handed the marks drawn on page 3, and nothing from any
 * other page.
 *
 * The same pass attaches the page's **annotations**, the other list a preview
 * paints. Both belong to the document and both are shown on the row's page, so
 * one pass is what keeps a card from having to ask again.
 */
export async function presentPages<T extends { pdf_document_id: number; page_number: number }>(
  db: Prisma.TransactionClient,
  rows: readonly T[],
): Promise<(Omit<T, "highlights"> & { highlights: string; annotations: string })[]> {
  const documentIds = [...new Set(rows.map((row) => row.pdf_document_id))];
  const marks =
    documentIds.length === 0
      ? []
      : await db.highlight.findMany({
          where: { pdf_document_id: { in: documentIds } },
          orderBy: { id: "asc" },
        });
  const byPage = new Map<string, HighlightMark[]>();
  for (const mark of marks) {
    const key = `${mark.pdf_document_id}:${mark.page_number}`;
    const list = byPage.get(key) ?? [];
    list.push(asMark(mark));
    byPage.set(key, list);
  }
  const annotations = await annotationsByPage(db, documentIds);
  return rows.map((row) => {
    const { highlights: _ignored, ...rest } = row as T & { highlights?: unknown };
    const key = `${row.pdf_document_id}:${row.page_number}`;
    return {
      ...rest,
      highlights: highlightJson(byPage.get(key) ?? []),
      annotations: annotationJson(annotations.get(key) ?? []),
    };
  });
}
