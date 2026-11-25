import type { PdfTag, PdfTagFolder } from "./types/dto";

/**
 * The rail's tag filter and the two grouping helpers the tag popovers share.
 *
 * Kept free of React and of the API layer so "what does a tag selection select"
 * can be tested without a DOM or a backend.
 */

/** Anything the rail can filter: a document with the tags it carries. */
export type TaggedDocument = { tags: { id: number }[] };

/**
 * The documents that carry **every** selected tag (AND).
 *
 * An empty selection means "no filter" and returns the list untouched, which is
 * what makes the filter button a toggle rather than a mode.
 */
export function filterDocumentsByTags<T extends TaggedDocument>(
  documents: T[],
  tagIds: number[],
): T[] {
  if (tagIds.length === 0) return documents;
  const wanted = new Set(tagIds);
  return documents.filter((document) => {
    const carried = new Set(document.tags.map((tag) => tag.id));
    for (const tagId of wanted) {
      if (!carried.has(tagId)) return false;
    }
    return true;
  });
}

/** One entry per tag folder, then the ungrouped tags; empty folders are kept. */
export function groupTagsByFolder(
  tags: PdfTag[],
  folders: PdfTagFolder[],
): { id: number | null; name: string; tags: PdfTag[] }[] {
  return [
    ...folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      tags: tags.filter((tag) => tag.pdf_tag_folder_id === folder.id),
    })),
    {
      id: null,
      name: "Ungrouped",
      tags: tags.filter((tag) => tag.pdf_tag_folder_id === null),
    },
  ];
}

/**
 * Drop ids whose tag no longer exists.
 *
 * A tag can disappear in another window while a filter or a selection holds it;
 * a selection that names a deleted tag would filter everything away and look
 * broken.
 */
export function pruneMissingTags(selectedIds: number[], tags: PdfTag[]): number[] {
  const available = new Set(tags.map((tag) => tag.id));
  return selectedIds.filter((id) => available.has(id));
}
