/**
 * The order a drag should write.
 *
 * The list on screen is the query cache, and the only mutation is the reorder
 * endpoint. This module turns a drop into the folder groups that endpoint
 * expects: one group when a strip moves inside its folder, two when it moves
 * into another folder. A no-op drop returns null so the caller sends nothing.
 */

/**
 * A group of strips that share a home. `folder_id: null` is the strips in no
 * folder, which the board shows as its own section and the strip menu can move a
 * strip into.
 */
export type StripGroup = { folder_id: number | null; strip_ids: number[] };

/** One place strips can sit: a folder's id, or null for "no folder". */
export type FolderStrips = { id: number | null; strip_ids: number[] };

/**
 * Reorder the rows on screen inside a longer list.
 *
 * The notes document list hides documents that have no strips, and a drag only
 * moves those rows. Hidden ids stay in the slots they already occupy; the
 * visible ones are written back into the slots they occupied, in the new order.
 * A drop on the same row returns null.
 */
export function planSubsetReorder(
  allIds: number[],
  visibleIds: number[],
  activeId: number,
  overId: number,
): number[] | null {
  const nextVisible = planFolderReorder(visibleIds, activeId, overId);
  if (!nextVisible) return null;
  const visible = new Set(visibleIds);
  let index = 0;
  return allIds.map((id) => (visible.has(id) ? nextVisible[index++]! : id));
}

/** New folder id list, or null when the folder was dropped on itself. */
export function planFolderReorder(folderIds: number[], activeId: number, overId: number): number[] | null {
  const from = folderIds.indexOf(activeId);
  const to = folderIds.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;
  return moveItem(folderIds, from, to);
}

/**
 * Where a strip drag lands.
 *
 * `over.type === "strip"` inserts at that strip. `over.type === "folder"`
 * appends to the group, which is the drop on a folder header, an empty folder or
 * the "No folder" header; `id: null` is that last one. Dropping a strip on its
 * own group is a no-op: the header is not a "send to end" target.
 */
export function planStripDrop(
  folders: FolderStrips[],
  activeStripId: number,
  over: { type: "strip"; id: number } | { type: "folder"; id: number | null },
): StripGroup[] | null {
  const source = folders.find((folder) => folder.strip_ids.includes(activeStripId));
  if (!source) return null;

  if (over.type === "folder") {
    if (over.id === source.id) return null;
    const target = folders.find((folder) => folder.id === over.id);
    if (!target) return null;
    return [
      { folder_id: source.id, strip_ids: source.strip_ids.filter((id) => id !== activeStripId) },
      { folder_id: target.id, strip_ids: [...target.strip_ids, activeStripId] },
    ];
  }

  const target = folders.find((folder) => folder.strip_ids.includes(over.id));
  if (!target) return null;
  const from = source.strip_ids.indexOf(activeStripId);
  const to = target.strip_ids.indexOf(over.id);
  if (source.id === target.id) {
    if (from === to) return null;
    return [{ folder_id: source.id, strip_ids: moveItem(source.strip_ids, from, to) }];
  }

  const destIds = target.strip_ids.slice();
  destIds.splice(to, 0, activeStripId);
  return [
    { folder_id: source.id, strip_ids: source.strip_ids.filter((id) => id !== activeStripId) },
    { folder_id: target.id, strip_ids: destIds },
  ];
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = items.slice();
  const [item] = next.splice(from, 1);
  if (item === undefined) return items;
  next.splice(to, 0, item);
  return next;
}
