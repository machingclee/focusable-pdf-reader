/**
 * The marks a document owns.
 *
 * A stroke is one row on a page of the PDF. Callers that still speak a strip
 * hand over the JSON list of `{ x0, x1, y, size }` for that strip's page: a
 * write replaces every mark on the page, and a read builds the same list back.
 * The document itself speaks `{ page, x0, x1, y, size }` for every page at once.
 */
import type { highlight, Prisma } from "../../../generated/prisma/client.ts";

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
 * Put each strip's page marks back into the JSON list the API returns.
 *
 * The rows live on the document. A strip on page 3 is handed the marks drawn
 * on page 3, and nothing from any other page.
 */
export async function presentStrips<T extends { pdf_document_id: number; page_number: number }>(
  db: Prisma.TransactionClient,
  strips: readonly T[],
): Promise<(Omit<T, "highlights"> & { highlights: string })[]> {
  const documentIds = [...new Set(strips.map((strip) => strip.pdf_document_id))];
  const rows =
    documentIds.length === 0
      ? []
      : await db.highlight.findMany({
          where: { pdf_document_id: { in: documentIds } },
          orderBy: { id: "asc" },
        });
  const byPage = new Map<string, HighlightMark[]>();
  for (const row of rows) {
    const key = `${row.pdf_document_id}:${row.page_number}`;
    const list = byPage.get(key) ?? [];
    list.push(asMark(row));
    byPage.set(key, list);
  }
  return strips.map((strip) => {
    const { highlights: _ignored, ...rest } = strip as T & { highlights?: unknown };
    const marks = byPage.get(`${strip.pdf_document_id}:${strip.page_number}`) ?? [];
    return { ...rest, highlights: highlightJson(marks) };
  });
}

/** Columns of a strip snapshot, without the mark list the document holds. */
export function stripColumns<T extends { highlights?: string | readonly highlight[] }>(
  strip: T,
): Omit<T, "highlights"> {
  const { highlights: _marks, ...columns } = strip;
  return columns;
}
