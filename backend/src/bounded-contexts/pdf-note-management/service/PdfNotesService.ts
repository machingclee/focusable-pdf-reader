import { Service } from "@machingclee/express-cqrs";
import type { Prisma } from "../../../generated/prisma/client.ts";
import { assertSameIds as assertSameIdSet } from "../../common/ids.ts";
import { presentStrips } from "../highlight/marks.ts";
import { comparePdfTags } from "../../pdf-tag-management/service/PdfTagCatalogService.ts";

/**
 * `pdfNotesService` — the domain service of the notes context.
 *
 * Only what more than one handler works with lives here: the drag order of the
 * document list, of a document's folders and of its unfiled strips, and the
 * "the request described exactly these rows" check the reorder handlers share.
 * A rule with a single consumer is a private method on that command handler
 * instead, so a use case reads top to bottom in one file.
 *
 * The container builds one instance and every handler injects it, so the
 * behaviour a use case depends on is a named collaborator at the constructor
 * rather than a class it reaches for. The service holds no state and does not
 * own a connection: the transaction client stays a parameter, which keeps the
 * transaction boundary visible at every call site.
 */
@Service()
export class PdfNotesService {
  /**
   * Every document, in drag order, with how many strips it has and the tags it
   * carries.
   *
   * The tags are flattened to `{ id, name, pdf_tag_folder_id }` in catalogue
   * order here, rather than left as junction rows, so the notes rail can render
   * chips and filter without knowing the assignment shape.
   *
   * Those are the PDF tag context's tables, and this is the one place the notes
   * context reads them: a document row carries its tags, so the list cannot be
   * built from `pdf_document` alone.
   */
  public async listDocuments(db: Prisma.TransactionClient) {
    const documents = await db.pdf_document.findMany({
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      include: {
        _count: { select: { notes: true } },
        assigned_tags: {
          include: {
            assigned_pdf_tag: {
              include: { pdf_tag: { include: { pdf_tag_folder: { select: { ordering: true } } } } },
            },
          },
        },
      },
    });
    return documents.map(({ assigned_tags, ...document }) => ({
      ...document,
      tags: assigned_tags
        .map((link) => {
          const tag = link.assigned_pdf_tag.pdf_tag;
          return {
            id: tag.id,
            name: tag.name,
            pdf_tag_folder_id: tag.pdf_tag_folder_id,
            folderOrdering: tag.pdf_tag_folder?.ordering ?? null,
          };
        })
        .sort(comparePdfTags)
        .map(({ folderOrdering: _folder, ...tag }) => tag),
    }));
  }

  /**
   * Make room at the front of the document list.
   *
   * A new document is shown first, which is where the newest file landed before
   * the list became a drag order. Every existing row moves down one, and the
   * caller writes `ordering: 0` on the row it creates.
   */
  public placeNewDocumentFirst(db: Prisma.TransactionClient) {
    return db.pdf_document.updateMany({ data: { ordering: { increment: 1 } } });
  }

  /** Folders of one document, each with its strips, both in drag order. */
  public async listFoldersWithStrips(db: Prisma.TransactionClient, pdfDocumentId: number) {
    const folders = await db.note_folder.findMany({
      where: { pdf_document_id: pdfDocumentId },
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      include: {
        notes: {
          orderBy: [{ ordering: "asc" }, { id: "asc" }],
        },
      },
    });
    const strips = folders.flatMap((folder) => folder.notes);
    const presented = await presentStrips(db, strips);
    const byId = new Map(presented.map((strip) => [strip.id, strip]));
    return folders.map((folder) => ({
      ...folder,
      notes: folder.notes.map((strip) => byId.get(strip.id)!),
    }));
  }

  /** The strips of a document that are in no folder, in their own drag order. */
  public async listUnfiledStrips(db: Prisma.TransactionClient, pdfDocumentId: number) {
    const strips = await db.note.findMany({
      where: { pdf_document_id: pdfDocumentId, note_folder_id: null },
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
    });
    return presentStrips(db, strips);
  }

  /** Refuse ids that do not describe exactly the rows the caller loaded. */
  public assertSameIds(expected: number[], actual: number[], message: string): void {
    assertSameIdSet(expected, actual, message);
  }
}
