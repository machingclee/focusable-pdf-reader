/**
 * The rail's tag filter.
 *
 * A view state rather than stored data, so ticking a tag applies immediately —
 * there is no Save. The selection is AND: a row stays only when it carries every
 * ticked tag. The list is grouped exactly like the manager, so a reader who
 * filed their tags can find them in the same place.
 */
import { useState } from "react";
import { Tag as TagIcon, X } from "lucide-react";
import { pdfTagApi } from "../store/api/pdfTagApi";
import { groupTagsByFolder } from "../documentTagFilter";
import { matchesTagFilter } from "../tagFilter";
import { TagPopoverShell, type TagPopoverAnchor } from "./TagPopoverShell";

export function TagFilterPopover({
  anchor,
  selectedIds,
  onChange,
  onClose,
}: {
  anchor: TagPopoverAnchor;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  onClose: () => void;
}) {
  const { data: tags = [], isLoading } = pdfTagApi.endpoints.listPdfTags.useQuery();
  const { data: folders = [] } = pdfTagApi.endpoints.listPdfTagFolders.useQuery();
  const [query, setQuery] = useState("");

  const groups = groupTagsByFolder(tags, folders)
    .map((group) => ({
      ...group,
      tags: group.tags.filter((tag) => matchesTagFilter(tag.name, query)),
    }))
    .filter((group) => group.tags.length > 0);

  function toggle(id: number) {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((current) => current !== id) : [...selectedIds, id],
    );
  }

  return (
    <TagPopoverShell anchor={anchor} label="Filter documents by tag" width={320} onClose={onClose}>
      <header className="tags-popover-head">
        <div>
          <p className="tags-popover-title">Filter by tag</p>
          <p className="tags-popover-hint">A document must carry every ticked tag.</p>
        </div>
        <button type="button" className="ghost tags-popover-close" onClick={onClose} aria-label="Close filter">
          <X size={16} aria-hidden />
        </button>
      </header>

      <div className="tags-popover-search">
        <input
          className="tag-field"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tags"
          aria-label="Search tags"
        />
        {query && (
          <button type="button" className="ghost tags-search-clear" onClick={() => setQuery("")} aria-label="Clear search">
            <X size={14} aria-hidden />
          </button>
        )}
      </div>

      <div className="tag-filter-body">
        {isLoading && <p className="tags-empty">Loading…</p>}
        {!isLoading && groups.length === 0 && <p className="tags-empty">No matching tags.</p>}
        {groups.map((group) => (
          <div key={group.id ?? "ungrouped"} className="tag-filter-group">
            <p className="tag-filter-group-title">{group.name}</p>
            {group.tags.map((tag) => (
              <label
                key={tag.id}
                className={`tag-row is-selectable${selectedIds.includes(tag.id) ? " is-selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(tag.id)}
                  onChange={() => toggle(tag.id)}
                />
                <TagIcon size={14} aria-hidden />
                <span className="tag-name">{tag.name}</span>
                <span className="tag-usage">{tag.document_count}</span>
              </label>
            ))}
          </div>
        ))}
      </div>

      <footer className="tags-popover-foot">
        <span className="tags-hint">{selectedIds.length} selected</span>
        <span className="tags-foot-actions">
          <button
            type="button"
            className="tag-small-button is-plain"
            onClick={() => onChange([])}
            disabled={selectedIds.length === 0}
          >
            Clear
          </button>
          <button type="button" className="tag-small-button" onClick={onClose}>
            Done
          </button>
        </span>
      </footer>
    </TagPopoverShell>
  );
}
