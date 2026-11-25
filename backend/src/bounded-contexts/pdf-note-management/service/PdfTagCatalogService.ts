import { Service } from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import type { Prisma } from "../../../generated/prisma/client.ts";
import type { DocumentTag, PdfTagFolder, PdfTagWithCount } from "../types.ts";

/** Longest a tag or tag-folder name may be, after trimming and collapsing spaces. */
export const PDF_TAG_NAME_MAX = 64;

/** Trim and collapse internal runs of whitespace: "  Data   Science " -> "Data Science". */
export function normalizePdfTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** The case-insensitive identity of a name; this is what `name_lower` stores. */
export function pdfTagNameKey(name: string): string {
  return normalizePdfTagName(name).toLocaleLowerCase();
}

/**
 * Catalogue order: a tag follows its folder's drag position, then its name;
 * ungrouped tags come last. Shared by the list query and the document list, so
 * both show the same order.
 */
export function comparePdfTags(
  left: { folderOrdering: number | null; name: string },
  right: { folderOrdering: number | null; name: string },
): number {
  const leftFolder = left.folderOrdering ?? Number.MAX_SAFE_INTEGER;
  const rightFolder = right.folderOrdering ?? Number.MAX_SAFE_INTEGER;
  if (leftFolder !== rightFolder) return leftFolder - rightFolder;
  return left.name.localeCompare(right.name);
}

/**
 * `pdfTagCatalogService` — the rules of the tag catalogue.
 *
 * The catalogue is its own aggregate: folders group tags, tags exist whether or
 * not a document carries them, and assignment lives elsewhere (on the document).
 * Only what more than one handler needs is here — the name rules, the uniqueness
 * checks the create/update handlers share, the catalogue order, and the
 * document's tag list the assignment handlers return.
 */
@Service()
export class PdfTagCatalogService {
  /** Trim and collapse spaces. */
  public normalize(name: string): string {
    return normalizePdfTagName(name);
  }

  /** The lowercased uniqueness key of a name. */
  public key(name: string): string {
    return pdfTagNameKey(name);
  }

  /**
   * Refuse a folder name another folder already uses, ignoring case.
   *
   * `exceptId` is the row being renamed: a rename to the same name in a
   * different case is a real change and must not collide with itself.
   */
  public async assertUniqueFolder(
    db: Prisma.TransactionClient,
    key: string,
    exceptId?: number,
  ): Promise<void> {
    const clash = await db.pdf_tag_folder.findFirst({
      where: { name_lower: key, ...(exceptId === undefined ? {} : { id: { not: exceptId } }) },
      select: { name: true },
    });
    if (clash) throw ErrorFactory.ofConflict(`A tag folder named "${clash.name}" already exists`);
  }

  /** Refuse a tag name another tag already uses, ignoring case. */
  public async assertUniqueTag(
    db: Prisma.TransactionClient,
    key: string,
    exceptId?: number,
  ): Promise<void> {
    const clash = await db.pdf_tag.findFirst({
      where: { name_lower: key, ...(exceptId === undefined ? {} : { id: { not: exceptId } }) },
      select: { name: true },
    });
    if (clash) throw ErrorFactory.ofConflict(`A tag named "${clash.name}" already exists`);
  }

  /** Every tag folder, in drag order. */
  public listFolders(db: Prisma.TransactionClient): Promise<PdfTagFolder[]> {
    return db.pdf_tag_folder.findMany({ orderBy: [{ ordering: "asc" }, { id: "asc" }] });
  }

  /** Every tag in the catalogue, with its usage count, in catalogue order. */
  public async listTags(db: Prisma.TransactionClient): Promise<PdfTagWithCount[]> {
    const tags = await db.pdf_tag.findMany({
      include: {
        _count: { select: { assignments: true } },
        pdf_tag_folder: { select: { ordering: true } },
      },
    });
    return tags
      .map(({ _count, pdf_tag_folder, ...tag }) => ({
        tag: { ...tag, document_count: _count.assignments },
        folderOrdering: pdf_tag_folder?.ordering ?? null,
      }))
      .sort((left, right) => comparePdfTags(
        { folderOrdering: left.folderOrdering, name: left.tag.name },
        { folderOrdering: right.folderOrdering, name: right.tag.name },
      ))
      .map((entry) => entry.tag);
  }

  /** One tag with its usage count; 404 when it is gone. */
  public async tagWithCount(
    db: Prisma.TransactionClient,
    tagId: number,
  ): Promise<PdfTagWithCount> {
    const tag = await db.pdf_tag.findUnique({
      where: { id: tagId },
      include: { _count: { select: { assignments: true } } },
    });
    if (!tag) throw ErrorFactory.ofNotFound(`PDF tag ${tagId} does not exist`);
    const { _count, ...row } = tag;
    return { ...row, document_count: _count.assignments };
  }

  /**
   * The tags on one document, through the assignment junction, in catalogue
   * order. This is what `GET /pdf-documents` embeds and what the assignment
   * commands answer with after the write.
   */
  public async tagsForDocument(
    db: Prisma.TransactionClient,
    pdfDocumentId: number,
  ): Promise<DocumentTag[]> {
    const links = await db.rel_pdf_document_assigned_pdf_tag.findMany({
      where: { pdf_document_id: pdfDocumentId },
      include: {
        assigned_pdf_tag: {
          include: { pdf_tag: { include: { pdf_tag_folder: { select: { ordering: true } } } } },
        },
      },
    });
    return links
      .map((link) => {
        const tag = link.assigned_pdf_tag.pdf_tag;
        return {
          id: tag.id,
          name: tag.name,
          pdf_tag_folder_id: tag.pdf_tag_folder_id,
          folderOrdering: tag.pdf_tag_folder?.ordering ?? null,
        };
      })
      .sort((left, right) => comparePdfTags(left, right))
      .map(({ folderOrdering: _folder, ...tag }) => tag);
  }
}
