/**
 * Tag assignment for one document, opened from its row's menu.
 *
 * The selection is local until Save: the reader can tick several tags, create a
 * new one, change their mind and Cancel, and nothing is written. Save sends the
 * difference the way the reference project's dialog does — the removals first,
 * then the additions — because the backend exposes assign and unassign as two
 * commands. The buttons stay disabled while either request is in flight, and a
 * failure leaves the panel open with the server's message instead of closing
 * over it.
 */
import { useEffect, useMemo, useState } from "react";
import { Folder as FolderIcon, Tag as TagIcon, X } from "lucide-react";
import { apiErrorMessage } from "../store/api/baseApi";
import { pdfDocumentApi } from "../store/api/pdfDocumentApi";
import { pdfTagApi } from "../store/api/pdfTagApi";
import { matchesTagFilter } from "../tagFilter";
import type { PdfDocumentListItem, PdfTagFolder } from "../types/dto";
import { TagNameForm } from "./TagNameForm";
import { TagPopoverShell, type TagPopoverAnchor } from "./TagPopoverShell";

export function DocumentTagsPopover({
  document,
  anchor,
  onClose,
}: {
  document: PdfDocumentListItem;
  anchor: TagPopoverAnchor;
  onClose: () => void;
}) {
  const { data: tags = [] } = pdfTagApi.endpoints.listPdfTags.useQuery();
  const { data: folders = [] } = pdfTagApi.endpoints.listPdfTagFolders.useQuery();
  const [createTag] = pdfTagApi.endpoints.createPdfTag.useMutation();
  const [createFolder] = pdfTagApi.endpoints.createPdfTagFolder.useMutation();
  const [assignTags, { isLoading: assigning }] = pdfDocumentApi.endpoints.assignPdfTags.useMutation();
  const [unassignTags, { isLoading: unassigning }] = pdfDocumentApi.endpoints.unassignPdfTags.useMutation();

  const assignedIds = useMemo(() => document.tags.map((tag) => tag.id), [document.tags]);
  const [selectedIds, setSelectedIds] = useState<number[]>(assignedIds);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const saving = assigning || unassigning;

  // A tag deleted elsewhere must not stay in the selection: Save would send an
  // id that no longer exists.
  useEffect(() => {
    setSelectedIds((ids) => {
      const next = ids.filter((id) => tags.some((tag) => tag.id === id));
      return next.length === ids.length ? ids : next;
    });
  }, [tags]);

  const searching = query.trim().length > 0;
  const visibleTags = searching
    ? tags.filter((tag) => matchesTagFilter(tag.name, query))
    : tags.filter((tag) => tag.pdf_tag_folder_id === selectedFolderId);

  const folderCounts = useMemo(() => {
    const byFolder = new Map<number, number>();
    let ungrouped = 0;
    for (const tag of tags) {
      if (tag.pdf_tag_folder_id === null) ungrouped += 1;
      else byFolder.set(tag.pdf_tag_folder_id, (byFolder.get(tag.pdf_tag_folder_id) ?? 0) + 1);
    }
    return { byFolder, ungrouped };
  }, [tags]);

  const added = selectedIds.filter((id) => !assignedIds.includes(id));
  const removed = assignedIds.filter((id) => !selectedIds.includes(id));
  const changed = added.length > 0 || removed.length > 0;

  function toggle(id: number) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((current) => current !== id) : [...ids, id]));
  }

  async function handleCreateFolder(name: string): Promise<boolean> {
    setError(null);
    try {
      const created = await createFolder({ name }).unwrap();
      setSelectedFolderId(created.id);
      return true;
    } catch (cause) {
      setError(apiErrorMessage(cause) ?? "Could not create that folder.");
      return false;
    }
  }

  async function handleCreateTag(name: string): Promise<boolean> {
    setError(null);
    try {
      const created = await createTag({ name, pdf_tag_folder_id: selectedFolderId }).unwrap();
      setSelectedIds((ids) => (ids.includes(created.id) ? ids : [...ids, created.id]));
      return true;
    } catch (cause) {
      setError(apiErrorMessage(cause) ?? "Could not create that tag.");
      return false;
    }
  }

  async function save() {
    if (saving) return;
    if (!changed) {
      onClose();
      return;
    }
    setError(null);
    try {
      if (removed.length > 0) await unassignTags({ id: document.id, pdf_tag_ids: removed }).unwrap();
      if (added.length > 0) await assignTags({ id: document.id, pdf_tag_ids: added }).unwrap();
      onClose();
    } catch (cause) {
      setError(apiErrorMessage(cause) ?? "Could not save the tags.");
    }
  }

  return (
    <TagPopoverShell anchor={anchor} label={`Tags for ${document.name}`} width={560} onClose={onClose}>
      <header className="tags-popover-head">
        <div>
          <p className="tags-popover-title">Tags for “{document.name}”</p>
          <p className="tags-popover-hint">Choose a folder and tick the tags to put on this document.</p>
        </div>
        <button type="button" className="ghost tags-popover-close" onClick={onClose} aria-label="Close tags">
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

      <div className="tags-popover-body">
        <aside className="tag-folder-list" aria-label="Tag folders">
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className={`tag-folder-name${selectedFolderId === folder.id && !searching ? " is-selected" : ""}`}
              onClick={() => {
                setQuery("");
                setSelectedFolderId(folder.id);
              }}
            >
              <FolderIcon size={14} aria-hidden />
              <span>{folder.name}</span>
              <span className="tag-usage">{folderCounts.byFolder.get(folder.id) ?? 0}</span>
            </button>
          ))}
          <button
            type="button"
            className={`tag-folder-name${selectedFolderId === null && !searching ? " is-selected" : ""}`}
            onClick={() => {
              setQuery("");
              setSelectedFolderId(null);
            }}
          >
            <FolderIcon size={14} aria-hidden />
            <span>Ungrouped</span>
            <span className="tag-usage">{folderCounts.ungrouped}</span>
          </button>
          <TagNameForm placeholder="New folder name" submitLabel="New folder" onCreate={handleCreateFolder} />
        </aside>

        <section className="tag-list" aria-label="Tags">
          {visibleTags.length === 0 && (
            <p className="tags-empty">{searching ? "No matching tags." : "No tags here yet."}</p>
          )}
          {visibleTags.map((tag) => (
            <TagChoice
              key={tag.id}
              name={tag.name}
              checked={selectedIds.includes(tag.id)}
              folderName={searching ? nameOfFolder(tag.pdf_tag_folder_id, folders) : null}
              onToggle={() => toggle(tag.id)}
            />
          ))}
          <TagNameForm placeholder="New tag name" submitLabel="New tag" onCreate={handleCreateTag} />
        </section>
      </div>

      <footer className="tags-popover-foot">
        <span className="tags-hint">
          {selectedIds.length} selected
          {error && (
            <span className="tags-error" role="alert">
              {" "}
              {error}
            </span>
          )}
        </span>
        <span className="tags-foot-actions">
          <button type="button" className="tag-small-button is-plain" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="tag-small-button" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </span>
      </footer>
    </TagPopoverShell>
  );
}

function nameOfFolder(folderId: number | null, folders: PdfTagFolder[]): string {
  if (folderId === null) return "Ungrouped";
  return folders.find((folder) => folder.id === folderId)?.name ?? "Ungrouped";
}

function TagChoice({
  name,
  checked,
  folderName,
  onToggle,
}: {
  name: string;
  checked: boolean;
  folderName: string | null;
  onToggle: () => void;
}) {
  return (
    <label className={`tag-row is-selectable${checked ? " is-selected" : ""}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <TagIcon size={14} aria-hidden />
      <span className="tag-name">{name}</span>
      {folderName && <span className="tag-folder-label">{folderName}</span>}
    </label>
  );
}
