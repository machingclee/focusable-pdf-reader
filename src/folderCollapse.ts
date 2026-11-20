/**
 * Which folders are open.
 *
 * Collapsing is a set of closed groups rather than a set of open ones, so the
 * default — a folder nobody has touched — is open, and a group added later (a new
 * folder, the "No folder" section) starts open too without anyone remembering to
 * put it in a list.
 *
 * `null` is the "No folder" group. It is toggled on its own and the one
 * collapse-all button leaves it alone: that button is about the folders.
 */

/** A group a strip can sit in: a folder id, or null for the strips in no folder. */
export type GroupId = number | null;

/** True when at least one folder is open. */
export function anyFolderExpanded(folderIds: number[], collapsed: ReadonlySet<GroupId>): boolean {
  return folderIds.some((id) => !collapsed.has(id));
}

/**
 * What the single collapse/expand button does next: collapse while at least one
 * folder is open, expand only when they are all closed.
 */
export function nextFolderAction(
  folderIds: number[],
  collapsed: ReadonlySet<GroupId>,
): "collapse" | "expand" {
  return anyFolderExpanded(folderIds, collapsed) ? "collapse" : "expand";
}

/** Open or close one group. */
export function toggleGroup(collapsed: ReadonlySet<GroupId>, id: GroupId): Set<GroupId> {
  const next = new Set(collapsed);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Open one group, which is what a drop into a closed folder does. */
export function expandGroup(collapsed: ReadonlySet<GroupId>, id: GroupId): Set<GroupId> {
  if (!collapsed.has(id)) return collapsed as Set<GroupId>;
  const next = new Set(collapsed);
  next.delete(id);
  return next;
}

/**
 * Apply the button: close every folder, or open every folder. Groups that are
 * not folders keep the state they had.
 */
export function setAllFoldersCollapsed(
  collapsed: ReadonlySet<GroupId>,
  folderIds: number[],
  close: boolean,
): Set<GroupId> {
  const next = new Set(collapsed);
  for (const id of folderIds) {
    if (close) next.add(id);
    else next.delete(id);
  }
  return next;
}
