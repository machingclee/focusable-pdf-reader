/**
 * The order a drag should write.
 *
 * The list on screen is the query cache, and the only mutation is the reorder
 * endpoint. This module turns a drop into the folder groups that endpoint
 * expects: one group when a strip moves inside its folder, two when it moves
 * into another folder. A no-op drop returns null so the caller sends nothing.
 */

/**
 * A group of strips that share a home. `note_folder_id: null` is the strips in no
 * folder, which the board shows as its own section and the strip menu can move a
 * strip into.
 */
export type StripGroup = { note_folder_id: number | null; note_ids: number[] };

/** One place strips can sit: a folder's id, or null for "no folder". */
export type FolderStrips = { id: number | null; note_ids: number[] };

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
  const source = folders.find((folder) => folder.note_ids.includes(activeStripId));
  if (!source) return null;

  if (over.type === "folder") {
    if (over.id === source.id) return null;
    const target = folders.find((folder) => folder.id === over.id);
    if (!target) return null;
    return [
      { note_folder_id: source.id, note_ids: source.note_ids.filter((id) => id !== activeStripId) },
      { note_folder_id: target.id, note_ids: [...target.note_ids, activeStripId] },
    ];
  }

  const target = folders.find((folder) => folder.note_ids.includes(over.id));
  if (!target) return null;
  const from = source.note_ids.indexOf(activeStripId);
  const to = target.note_ids.indexOf(over.id);
  if (source.id === target.id) {
    if (from === to) return null;
    return [{ note_folder_id: source.id, note_ids: moveItem(source.note_ids, from, to) }];
  }

  const destIds = target.note_ids.slice();
  destIds.splice(to, 0, activeStripId);
  return [
    { note_folder_id: source.id, note_ids: source.note_ids.filter((id) => id !== activeStripId) },
    { note_folder_id: target.id, note_ids: destIds },
  ];
}

/**
 * Where a document dropped on a document in another list should sit.
 *
 * The upper half of the target row inserts before it; the lower half inserts
 * after it, which is how a drop on the last PDF can still land at the end.
 * A document already in the list moves to that slot. A drop that would leave
 * the list as it is returns null.
 */
export function planMemberInsert(
  memberIds: number[],
  activeId: number,
  overId: number,
  placeAfter: boolean,
): number[] | null {
  if (activeId === overId) return null;
  const overIndex = memberIds.indexOf(overId);
  if (overIndex < 0) return null;

  const from = memberIds.indexOf(activeId);
  const without = from < 0 ? memberIds.slice() : memberIds.filter((id) => id !== activeId);
  const adjustedOver = from >= 0 && from < overIndex ? overIndex - 1 : overIndex;
  const index = Math.min(without.length, adjustedOver + (placeAfter ? 1 : 0));
  if (from >= 0 && index === from) return null;

  const next = without.slice();
  next.splice(index, 0, activeId);
  return next;
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = items.slice();
  const [item] = next.splice(from, 1);
  if (item === undefined) return items;
  next.splice(to, 0, item);
  return next;
}
