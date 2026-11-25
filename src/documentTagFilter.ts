import type { PdfTag } from "./types/dto";

/**
 * The rail's tag filter, kept free of React and of the API layer so "what does
 * the filter select" can be tested without a DOM or a backend.
 */

/** Anything the rail can filter: a document with the tags it carries. */
export type TaggedDocument = { tags: { id: number }[] };

/**
 * The documents carrying `tagId`.
 *
 * One tag at a time, by design: the rail's field is a picker rather than a
 * query builder, so a pick replaces the last one instead of narrowing beside it.
 * No tag means "no filter" and returns the list untouched, which is what makes
 * the field a filter rather than a mode.
 */
export function filterDocumentsByTag<T extends TaggedDocument>(
  documents: T[],
  tagId: number | null,
): T[] {
  if (tagId === null) return documents;
  return documents.filter((document) => document.tags.some((tag) => tag.id === tagId));
}

/**
 * The tag the filter may keep holding: the same id, or null when that tag is
 * gone.
 *
 * A tag can be deleted in the manager, or in another window, while the filter
 * holds it; a filter naming a deleted tag would empty the rail and look broken.
 */
export function pruneMissingTag(selected: number | null, tags: PdfTag[]): number | null {
  if (selected === null) return null;
  return tags.some((tag) => tag.id === selected) ? selected : null;
}
