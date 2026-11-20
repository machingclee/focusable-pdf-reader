import type { AppPrisma } from "./db.ts";
import { badRequest, conflict, notFound } from "./http.ts";

/** Name of the folder created when a document gets its first strip. */
export const DEFAULT_FOLDER_NAME = "Strips";

/**
 * Strips that share a home. `folder_id: null` is the group of strips that are in
 * no folder, which the strip menu can move a strip into and out of.
 */
type StripGroup = { folder_id: number | null; strip_ids: number[] };

/**
 * The folder a newly saved strip belongs to.
 *
 * The viewer knows the document, not which folder the reader had open, so a
 * missing `folderId` means "the first folder". A document that has none yet
 * gets the default folder rather than refusing the save.
 */
export async function folderForNewStrip(
  db: AppPrisma,
  pdfDocumentId: number,
  folderId: number | undefined,
) {
  if (folderId !== undefined) {
    const folder = await db.folder.findUnique({ where: { id: folderId } });
    if (!folder || folder.pdf_document_id !== pdfDocumentId) {
      throw notFound(`Folder ${folderId} does not exist on document ${pdfDocumentId}`);
    }
    return folder;
  }

  const existing = await db.folder.findFirst({
    where: { pdf_document_id: pdfDocumentId },
    orderBy: { ordering: "asc" },
  });
  if (existing) return existing;

  return db.folder.create({
    data: {
      pdf_document_id: pdfDocumentId,
      name: DEFAULT_FOLDER_NAME,
      ordering: 0,
      created_at: Date.now(),
    },
  });
}

/** Next `ordering` at the end of a folder, so a new strip does not jump the queue. */
export async function nextStripOrdering(db: AppPrisma, folderId: number): Promise<number> {
  const last = await db.focusable_strip.aggregate({
    where: { folder_id: folderId },
    _max: { ordering: true },
  });
  return (last._max.ordering ?? -1) + 1;
}

/** Folders of one document, each with its strips, both in drag order. */
export function listFoldersWithStrips(db: AppPrisma, pdfDocumentId: number) {
  return db.folder.findMany({
    where: { pdf_document_id: pdfDocumentId },
    orderBy: [{ ordering: "asc" }, { id: "asc" }],
    include: {
      focusable_strips: { orderBy: [{ ordering: "asc" }, { id: "asc" }] },
    },
  });
}

/**
 * Rewrite folder positions for one document.
 *
 * `folderIds` must be exactly that document's folders, in the new order.
 * `ordering` becomes the index, so the column stays dense and the list query
 * does not have to know about gaps.
 */
export async function reorderFolders(db: AppPrisma, pdfDocumentId: number, folderIds: number[]) {
  const existing = await db.folder.findMany({
    where: { pdf_document_id: pdfDocumentId },
    select: { id: true },
  });
  assertSameIds(
    existing.map((folder) => folder.id),
    folderIds,
    "folder_ids must list every folder of the document once",
  );

  await db.$transaction(
    folderIds.map((id, ordering) => db.folder.update({ where: { id }, data: { ordering } })),
  );
  return listFoldersWithStrips(db, pdfDocumentId);
}

/** The strips of a document that are in no folder, in their own drag order. */
export function listUnfiledStrips(db: AppPrisma, pdfDocumentId: number) {
  return db.focusable_strip.findMany({
    where: { pdf_document_id: pdfDocumentId, folder_id: null },
    orderBy: [{ ordering: "asc" }, { id: "asc" }],
  });
}

/**
 * Rewrite which strips sit in the given groups, and their order.
 *
 * A group is a folder, or `null` for the strips in no folder. A drag that stays
 * inside one group sends one group; a drag into another sends the source and the
 * destination, each with its full new id list. The lists together must be exactly
 * the strips those groups hold now, so a strip cannot disappear or be pulled in
 * from a group the request forgot.
 */
export async function reorderStrips(db: AppPrisma, groups: StripGroup[]) {
  const folderIds = groups.flatMap((group) => (group.folder_id === null ? [] : [group.folder_id]));
  if (new Set(folderIds).size !== folderIds.length) {
    throw badRequest("groups must not repeat a folder_id");
  }
  const unfiledGroups = groups.filter((group) => group.folder_id === null).length;
  if (unfiledGroups > 1) throw badRequest("groups must not repeat the unfiled group");

  const folders = await db.folder.findMany({
    where: { id: { in: folderIds } },
    select: { id: true, pdf_document_id: true },
  });
  if (folders.length !== folderIds.length) throw notFound("A folder in groups does not exist");
  const folderDocumentIds = new Set(folders.map((folder) => folder.pdf_document_id));
  if (folderDocumentIds.size > 1) throw badRequest("groups must all belong to one document");

  const payloadIds = groups.flatMap((group) => group.strip_ids);
  if (payloadIds.length === 0) throw badRequest("groups must list at least one strip");
  if (new Set(payloadIds).size !== payloadIds.length) {
    throw badRequest("a strip cannot appear twice in groups");
  }

  const strips = await db.focusable_strip.findMany({
    where: { id: { in: payloadIds } },
    select: { id: true, pdf_document_id: true },
  });
  if (strips.length !== payloadIds.length) throw notFound("A strip in groups does not exist");

  // The unfiled group has no folder to name its document, so those strips name it
  // themselves. Both sources have to agree: a request cannot move a strip between
  // documents by pointing it at someone else's folder.
  const documentIds = new Set([
    ...folderDocumentIds,
    ...strips.map((strip) => strip.pdf_document_id),
  ]);
  if (documentIds.size !== 1) throw badRequest("groups must all belong to one document");
  const pdfDocumentId = strips[0]!.pdf_document_id;

  // The lists together must be exactly what those groups hold now: nothing left
  // behind in a group the request forgot, nothing pulled in from one it did not
  // name. This is also what stops a move from deleting a strip, and it is why
  // the destination may list a strip that is still in the source today.
  const current = await db.focusable_strip.findMany({
    where: {
      pdf_document_id: pdfDocumentId,
      ...(unfiledGroups === 1
        ? { OR: [{ folder_id: { in: folderIds } }, { folder_id: null }] }
        : { folder_id: { in: folderIds } }),
    },
    select: { id: true },
  });
  assertSameIds(
    current.map((strip) => strip.id),
    payloadIds,
    "groups must list every strip of the given groups once",
  );

  const writes = groups.flatMap((group) =>
    group.strip_ids.map((id, ordering) =>
      db.focusable_strip.update({
        where: { id },
        data: { folder_id: group.folder_id, ordering },
      }),
    ),
  );
  // A group emptied by the drag contributes no writes. Prisma rejects an empty batch.
  if (writes.length > 0) await db.$transaction(writes);
  return listFoldersWithStrips(db, pdfDocumentId);
}

/**
 * Delete a folder.
 *
 * An empty folder always goes. A folder that still holds strips is refused
 * unless `withStrips` is set: the strips are deleted with it (the relation
 * cascades), and that is a big enough loss to be an explicit request rather than
 * the default, so a caller that forgot to look at `_count` cannot wipe notes.
 */
export async function deleteFolder(db: AppPrisma, id: number, options: { withStrips?: boolean } = {}) {
  const folder = await db.folder.findUnique({
    where: { id },
    include: { _count: { select: { focusable_strips: true } } },
  });
  if (!folder) throw notFound(`Folder ${id} does not exist`);

  const stripCount = folder._count.focusable_strips;
  if (stripCount > 0 && !options.withStrips) {
    throw conflict("This folder still has strips. Move or delete them first.");
  }
  await db.folder.delete({ where: { id } });
}

function assertSameIds(expected: number[], actual: number[], message: string) {
  if (expected.length !== actual.length || new Set(actual).size !== actual.length) {
    throw badRequest(message);
  }
  const wanted = new Set(expected);
  if (actual.some((id) => !wanted.has(id))) throw badRequest(message);
}
