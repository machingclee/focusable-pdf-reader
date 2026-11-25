/**
 * Whether a tag (or tag-folder) name matches what the reader typed, and how a
 * `/tags` draft is read.
 *
 * The matching rule is the reference project's: the query is split on spaces and
 * the parts must appear in order, but not necessarily next to each other — so
 * "event storm" finds "Event Storming", and casing never matters. Pure, so the
 * manager, the assignment popover and the rail filter share one definition
 * instead of three slightly different ones.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesTagFilter(name: string, query: string): boolean {
  const parts = query.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return true;
  return new RegExp(parts.map(escapeRegExp).join(".*"), "i").test(name);
}

/**
 * The command the reference project's title-bar search advertises for a refined
 * tag search. The rail's own field is the refined search, so the command is only
 * tolerated here — a reader who types it out of habit is still searching tags.
 */
const TAGS_COMMAND = "/tags";

/**
 * The draft with a leading `/tags` token taken off, ready for `matchesTagFilter`.
 *
 * `/tags lang` reads as `lang`; `/tags` alone reads as an empty query, which
 * matches every tag. Any other draft is returned trimmed and untouched.
 */
export function stripTagsCommand(value: string): string {
  const trimmed = value.trim();
  const command = new RegExp(`^${escapeRegExp(TAGS_COMMAND)}(?:\\s+|$)`, "i");
  return trimmed.replace(command, "").trim();
}
