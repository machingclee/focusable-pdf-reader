import type { Prisma } from "../../../generated/prisma/client.ts";
import { ErrorFactory } from "../../../common/http.ts";

/**
 * `pdfNotesService` — the domain service of the notes context.
 *
 * Only what more than one handler works with lives here: the drag order of the
 * document list, of a document's folders and of its unfiled strips, and the
 * "the request described exactly these rows" check the reorder handlers share.
 * A rule with a single consumer is a private method on that command handler
 * instead, so a use case reads top to bottom in one file.
 *
 * Stateless, so the members are static instead of an injected `@Service`: there
 * is nothing to construct, and taking the transaction client as a parameter
 * keeps the transaction boundary visible at every call site.
 */
export class PdfNotesService {
  /** Never instantiated: the service has no state to hold. */
  private constructor() { }

  /** Every document, in drag order, with how many strips it has. */
  public static listDocuments(db: Prisma.TransactionClient) {
    return db.pdf_document.findMany({
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      include: { _count: { select: { focusable_strips: true } } },
    });
  }

  /**
   * Make room at the front of the document list.
   *
   * A new document is shown first, which is where the newest file landed before
   * the list became a drag order. Every existing row moves down one, and the
   * caller writes `ordering: 0` on the row it creates.
   */
  public static placeNewDocumentFirst(db: Prisma.TransactionClient) {
    return db.pdf_document.updateMany({ data: { ordering: { increment: 1 } } });
  }

  /** Folders of one document, each with its strips, both in drag order. */
  public static listFoldersWithStrips(db: Prisma.TransactionClient, pdfDocumentId: number) {
    return db.folder.findMany({
      where: { pdf_document_id: pdfDocumentId },
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      include: {
        focusable_strips: { orderBy: [{ ordering: "asc" }, { id: "asc" }] },
      },
    });
  }

  /** The strips of a document that are in no folder, in their own drag order. */
  public static listUnfiledStrips(db: Prisma.TransactionClient, pdfDocumentId: number) {
    return db.focusable_strip.findMany({
      where: { pdf_document_id: pdfDocumentId, folder_id: null },
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
    });
  }

  /**
   * Refuse ids that do not describe exactly the rows the caller loaded: same
   * length, no repeats, same members. Shared by both reorder handlers, which
   * both have to prove the payload matches what the database holds now.
   */
  public static assertSameIds(expected: number[], actual: number[], message: string): void {
    if (expected.length !== actual.length || new Set(actual).size !== actual.length) {
      throw ErrorFactory.ofBadRequest(message);
    }
    const wanted = new Set(expected);
    if (actual.some((id) => !wanted.has(id))) throw ErrorFactory.ofBadRequest(message);
  }
}
