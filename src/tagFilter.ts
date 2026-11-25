/**
 * Whether a tag (or tag-folder) name matches what the reader typed.
 *
 * The same rule the reference project's tag search uses: the query is split on
 * spaces and the parts must appear in order, but not necessarily next to each
 * other — so "event storm" finds "Event Storming", and casing never matters.
 * Pure, so the manager, the assignment popover and the rail filter share one
 * definition instead of three slightly different ones.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesTagFilter(name: string, query: string): boolean {
  const parts = query.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return true;
  return new RegExp(parts.map(escapeRegExp).join(".*"), "i").test(name);
}
