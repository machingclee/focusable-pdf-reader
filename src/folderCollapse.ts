/**
 * Which folders are open.
 *
 * Open is a set of groups the reader has opened, so the default — a group nobody
 * has touched — is **closed**: the column opens as a list of folder names, and the
 * notes of the one the reader picks are what it shows. A group added later (a new
 * folder, the "No folder" section) starts closed for the same reason, without
 * anyone having to remember to put it in a list.
 *
 * The trade is that anything which needs a card on screen has to open its group
 * first: revealing a strip, saving one, dropping one into a folder. Those are the
 * `openGroup` calls in `StripList`, and they are what keep a closed folder from
 * hiding something the reader just asked for.
 *
 * `null` is the "No folder" group. It is toggled on its own and the one
 * collapse-all button leaves it alone: that button is about the folders.
 */

/** A group a strip can sit in: a folder id, or null for the strips in no folder. */
export type GroupId = number | null;

/** True when at least one folder is open. */
export function anyFolderOpen(folderIds: number[], open: ReadonlySet<GroupId>): boolean {
  return folderIds.some((id) => open.has(id));
}

/**
 * What the single collapse/expand button does next: open the rest while any folder
 * is closed, and close them all only once every one of them is open.
 */
export function nextFolderAction(
  folderIds: number[],
  open: ReadonlySet<GroupId>,
): "collapse" | "expand" {
  // With no folders there is nothing to close, and the button is not drawn anyway.
  if (folderIds.length === 0) return "expand";
  return folderIds.every((id) => open.has(id)) ? "collapse" : "expand";
}

/** Open or close one group. */
export function toggleGroup(open: ReadonlySet<GroupId>, id: GroupId): Set<GroupId> {
  const next = new Set(open);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Open one group, which is what revealing a card or dropping into it does. */
export function openGroup(open: ReadonlySet<GroupId>, id: GroupId): Set<GroupId> {
  if (open.has(id)) return open as Set<GroupId>;
  const next = new Set(open);
  next.add(id);
  return next;
}

/**
 * Apply the button: open every folder, or close every folder. Groups that are not
 * folders keep the state they had.
 */
export function setAllFoldersOpen(
  open: ReadonlySet<GroupId>,
  folderIds: number[],
  openAll: boolean,
): Set<GroupId> {
  const next = new Set(open);
  for (const id of folderIds) {
    if (openAll) next.add(id);
    else next.delete(id);
  }
  return next;
}
