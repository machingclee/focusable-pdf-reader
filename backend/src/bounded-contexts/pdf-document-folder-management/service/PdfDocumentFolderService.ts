import { Service } from "@machingclee/express-cqrs";
import { ErrorFactory } from "../../../common/http.ts";
import type { Prisma } from "../../../generated/prisma/client.ts";
import type { PdfDocumentFolderView } from "../types.ts";

/** Longest a document-folder name may be, after trimming and collapsing spaces. */
export const PDF_DOCUMENT_FOLDER_NAME_MAX = 64;

/** Trim and collapse internal runs of whitespace. */
export function normalizePdfDocumentFolderName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** The case-insensitive identity of a name; this is what `name_lower` stores. */
export function pdfDocumentFolderNameKey(name: string): string {
  return normalizePdfDocumentFolderName(name).toLocaleLowerCase();
}

type FolderWithMembers = {
  id: number;
  name: string;
  ordering: number;
  created_at: number;
  memberships: { pdf_document_id: number; ordering: number }[];
};

/**
 * The rules the document-folder handlers share: the name, the uniqueness check,
 * and the list shape (folder, then its document ids in membership order).
 */
@Service()
export class PdfDocumentFolderService {
  public normalize(name: string): string {
    return normalizePdfDocumentFolderName(name);
  }

  public key(name: string): string {
    return pdfDocumentFolderNameKey(name);
  }

  /**
   * Refuse a folder name another folder already uses, ignoring case.
   *
   * `exceptId` is the row being renamed, so a case-only change does not collide
   * with itself.
   */
  public async assertUniqueFolder(
    db: Prisma.TransactionClient,
    key: string,
    exceptId?: number,
  ): Promise<void> {
    const clash = await db.pdf_document_folder.findFirst({
      where: { name_lower: key, ...(exceptId === undefined ? {} : { id: { not: exceptId } }) },
      select: { name: true },
    });
    if (clash) {
      throw ErrorFactory.ofConflict(`A document folder named "${clash.name}" already exists`);
    }
  }

  /** Every document folder, in drag order, each with its documents in membership order. */
  public async listFolders(db: Prisma.TransactionClient): Promise<PdfDocumentFolderView[]> {
    const folders = await db.pdf_document_folder.findMany({
      orderBy: [{ ordering: "asc" }, { id: "asc" }],
      include: {
        memberships: {
          orderBy: [{ ordering: "asc" }, { id: "asc" }],
          select: { pdf_document_id: true, ordering: true },
        },
      },
    });
    return folders.map((folder) => this.present(folder));
  }

  /** One folder in the list shape; 404 when it is gone. */
  public async folder(db: Prisma.TransactionClient, id: number): Promise<PdfDocumentFolderView> {
    const folder = await db.pdf_document_folder.findUnique({
      where: { id },
      include: {
        memberships: {
          orderBy: [{ ordering: "asc" }, { id: "asc" }],
          select: { pdf_document_id: true, ordering: true },
        },
      },
    });
    if (!folder) throw ErrorFactory.ofNotFound(`Document folder ${id} does not exist`);
    return this.present(folder);
  }

  public present(folder: FolderWithMembers): PdfDocumentFolderView {
    const pdf_document_ids = [...folder.memberships]
      .sort((left, right) => left.ordering - right.ordering || left.pdf_document_id - right.pdf_document_id)
      .map((membership) => membership.pdf_document_id);
    return {
      id: folder.id,
      name: folder.name,
      ordering: folder.ordering,
      created_at: folder.created_at,
      pdf_document_ids,
      document_count: pdf_document_ids.length,
    };
  }
}
