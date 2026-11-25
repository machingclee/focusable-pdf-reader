/**
 * The tag manager: the catalogue, and the folders that group it.
 *
 * Two panes, the way the reference project's Tags Manager is laid out: folders
 * on the left (drag to reorder, rename, delete), the selected folder's tags on
 * the right (create, rename, move between folders, delete). Typing in the search
 * box searches every tag and shows each one's folder, because a search that only
 * looked inside the selected folder would hide the tag you are trying to find.
 *
 * This surface only manages the catalogue. Putting a tag on a document happens
 * in `DocumentTagsPopover`, from the document row's menu.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Folder as FolderIcon, Pencil, Tag as TagIcon, Trash2, X } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { apiErrorMessage } from "../store/api/baseApi";
import { pdfTagApi } from "../store/api/pdfTagApi";
import { matchesTagFilter } from "../tagFilter";
import type { PdfTag } from "../types/dto";
import { SortableItem } from "./dnd/SortableItem";
import { TagNameForm } from "./TagNameForm";
import { TagPopoverShell, type TagPopoverAnchor } from "./TagPopoverShell";

export function TagManagerPopover({
  anchor,
  onClose,
}: {
  anchor: TagPopoverAnchor;
  onClose: () => void;
}) {
  const { data: tags = [], isLoading: tagsLoading } = pdfTagApi.endpoints.listPdfTags.useQuery();
  const { data: folders = [] } = pdfTagApi.endpoints.listPdfTagFolders.useQuery();
  const [createFolder] = pdfTagApi.endpoints.createPdfTagFolder.useMutation();
  const [renameFolder] = pdfTagApi.endpoints.renamePdfTagFolder.useMutation();
  const [deleteFolder] = pdfTagApi.endpoints.deletePdfTagFolder.useMutation();
  const [reorderFolders] = pdfTagApi.endpoints.reorderPdfTagFolders.useMutation();
  const [createTag] = pdfTagApi.endpoints.createPdfTag.useMutation();
  const [updateTag] = pdfTagApi.endpoints.updatePdfTag.useMutation();
  const [deleteTag] = pdfTagApi.endpoints.deletePdfTag.useMutation();

  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Which row is being renamed, and the draft. Only one at a time. */
  const [renaming, setRenaming] = useState<{ kind: "folder" | "tag"; id: number; draft: string } | null>(null);
  /** Arming the destructive action, the same two-click rule the menus use. */
  const [armed, setArmed] = useState<string | null>(null);

  const searching = query.trim().length > 0;

  // A folder can disappear under the selection (deleted here or in another
  // window); fall back to Ungrouped rather than showing an empty list.
  useEffect(() => {
    if (selectedFolderId !== null && !folders.some((folder) => folder.id === selectedFolderId)) {
      setSelectedFolderId(null);
    }
  }, [folders, selectedFolderId]);

  const counts = useMemo(() => {
    const byFolder = new Map<number, number>();
    let ungrouped = 0;
    for (const tag of tags) {
      if (tag.pdf_tag_folder_id === null) ungrouped += 1;
      else byFolder.set(tag.pdf_tag_folder_id, (byFolder.get(tag.pdf_tag_folder_id) ?? 0) + 1);
    }
    return { byFolder, ungrouped };
  }, [tags]);

  const visibleTags = searching
    ? tags.filter((tag) => matchesTagFilter(tag.name, query))
    : tags.filter((tag) => tag.pdf_tag_folder_id === selectedFolderId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Run a write, surface its error in the footer, and hand back its value. */
  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setError(null);
    try {
      return await action();
    } catch (cause) {
      setError(apiErrorMessage(cause) ?? "Could not change the tags.");
      return undefined;
    }
  }

  async function handleCreateFolder(name: string) {
    const created = await run(() => createFolder({ name }).unwrap());
    if (!created) return false;
    setSelectedFolderId(created.id);
    return true;
  }

  async function handleRename() {
    if (!renaming) return;
    const name = renaming.draft.trim();
    if (!name) return;
    const saved =
      renaming.kind === "folder"
        ? await run(() => renameFolder({ id: renaming.id, name }).unwrap())
        : await run(() => updateTag({ id: renaming.id, name }).unwrap());
    if (saved !== undefined) setRenaming(null);
  }

  function toggleArmed(key: string) {
    setArmed((current) => (current === key ? null : key));
  }

  return (
    <TagPopoverShell anchor={anchor} label="Tags" onClose={onClose} width={620}>
      <header className="tags-popover-head">
        <div>
          <p className="tags-popover-title">Tags</p>
          <p className="tags-popover-hint">
            Folders group tags. A tag belongs to one folder, or to none.
          </p>
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event: DragEndEvent) => {
              const { active, over } = event;
              if (!over || active.id === over.id) return;
              const from = folders.findIndex((folder) => `tag-folder-${folder.id}` === active.id);
              const to = folders.findIndex((folder) => `tag-folder-${folder.id}` === over.id);
              if (from < 0 || to < 0) return;
              const next = arrayMove(folders, from, to);
              void run(() => reorderFolders({ pdf_tag_folder_ids: next.map((folder) => folder.id) }).unwrap());
            }}
          >
            <SortableContext
              items={folders.map((folder) => `tag-folder-${folder.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {folders.map((folder) => (
                <SortableItem key={folder.id} id={`tag-folder-${folder.id}`} data={{ type: "tag-folder", folder }}>
                  <div className={`tag-folder-row${selectedFolderId === folder.id && !searching ? " is-selected" : ""}`}>
                    {renaming?.kind === "folder" && renaming.id === folder.id ? (
                      <form
                        className="tag-inline-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleRename();
                        }}
                      >
                        <input
                          className="tag-field"
                          value={renaming.draft}
                          autoFocus
                          aria-label="Tag folder name"
                          onChange={(event) =>
                            setRenaming({ kind: "folder", id: folder.id, draft: event.target.value })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setRenaming(null);
                          }}
                        />
                        <button type="submit" className="tag-small-button" disabled={!renaming.draft.trim()}>
                          Save
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="tag-folder-name"
                          onClick={() => {
                            setQuery("");
                            setSelectedFolderId(folder.id);
                          }}
                        >
                          <FolderIcon size={14} aria-hidden />
                          <span>{folder.name}</span>
                          <span className="tag-usage">{counts.byFolder.get(folder.id) ?? 0}</span>
                        </button>
                        <button
                          type="button"
                          className="ghost tag-row-action"
                          title="Rename folder"
                          aria-label={`Rename ${folder.name}`}
                          onClick={() => setRenaming({ kind: "folder", id: folder.id, draft: folder.name })}
                        >
                          <Pencil size={13} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={`ghost tag-row-action${armed === `folder-${folder.id}` ? " is-danger" : ""}`}
                          title={
                            armed === `folder-${folder.id}`
                              ? "Delete the folder; its tags move to Ungrouped"
                              : "Delete folder"
                          }
                          aria-label={
                            armed === `folder-${folder.id}` ? `Confirm deleting ${folder.name}` : `Delete ${folder.name}`
                          }
                          onClick={() => {
                            if (armed !== `folder-${folder.id}`) {
                              toggleArmed(`folder-${folder.id}`);
                              return;
                            }
                            setArmed(null);
                            void run(() => deleteFolder(folder.id).unwrap());
                          }}
                        >
                          <Trash2 size={13} aria-hidden />
                        </button>
                      </>
                    )}
                  </div>
                </SortableItem>
              ))}
            </SortableContext>
          </DndContext>

          <button
            type="button"
            className={`tag-folder-name is-ungrouped${selectedFolderId === null && !searching ? " is-selected" : ""}`}
            onClick={() => {
              setQuery("");
              setSelectedFolderId(null);
            }}
          >
            <FolderIcon size={14} aria-hidden />
            <span>Ungrouped</span>
            <span className="tag-usage">{counts.ungrouped}</span>
          </button>

          <TagNameForm placeholder="New folder name" submitLabel="Create folder" onCreate={handleCreateFolder} />
        </aside>

        <section className="tag-list" aria-label={searching ? "All tags" : "Tags in this folder"}>
          {tagsLoading && <p className="tags-empty">Loading…</p>}
          {!tagsLoading && visibleTags.length === 0 && (
            <p className="tags-empty">
              {searching ? "No matching tags." : "No tags here yet."}
            </p>
          )}
          {visibleTags.map((tag) => (
            <TagRow
              key={tag.id}
              tag={tag}
              folderName={searching ? folderNameFor(tag, folders) : null}
              armed={armed === `tag-${tag.id}`}
              renaming={renaming?.kind === "tag" && renaming.id === tag.id}
              draft={renaming?.kind === "tag" && renaming.id === tag.id ? renaming.draft : ""}
              folders={folders}
              onStartRename={() => setRenaming({ kind: "tag", id: tag.id, draft: tag.name })}
              onChangeDraft={(draft) => setRenaming({ kind: "tag", id: tag.id, draft })}
              onCancelRename={() => setRenaming(null)}
              onSaveRename={() => void handleRename()}
              onMove={(folderId) => void run(() => updateTag({ id: tag.id, pdf_tag_folder_id: folderId }).unwrap())}
              onDelete={() => {
                if (armed !== `tag-${tag.id}`) {
                  toggleArmed(`tag-${tag.id}`);
                  return;
                }
                setArmed(null);
                void run(() => deleteTag(tag.id).unwrap());
              }}
            />
          ))}

          <TagNameForm
            placeholder="New tag name"
            submitLabel="Create tag"
            onCreate={async (name) => {
              const created = await run(() =>
                createTag({ name, pdf_tag_folder_id: selectedFolderId }).unwrap(),
              );
              return created !== undefined;
            }}
          />
        </section>
      </div>

      <footer className="tags-popover-foot">
        {error ? (
          <span className="tags-error" role="alert">
            {error}
          </span>
        ) : (
          <span className="tags-hint">Right-click a document row to put tags on it.</span>
        )}
      </footer>
    </TagPopoverShell>
  );
}

/** The folder a tag belongs to, for the flat search result list. */
function folderNameFor(tag: PdfTag, folders: { id: number; name: string }[]): string {
  if (tag.pdf_tag_folder_id === null) return "Ungrouped";
  return folders.find((folder) => folder.id === tag.pdf_tag_folder_id)?.name ?? "Ungrouped";
}

function TagRow({
  tag,
  folderName,
  armed,
  renaming,
  draft,
  folders,
  onStartRename,
  onChangeDraft,
  onCancelRename,
  onSaveRename,
  onMove,
  onDelete,
}: {
  tag: PdfTag;
  /** Set only while searching: the flat list says which folder each tag is in. */
  folderName: string | null;
  armed: boolean;
  renaming: boolean;
  draft: string;
  folders: { id: number; name: string }[];
  onStartRename: () => void;
  onChangeDraft: (draft: string) => void;
  onCancelRename: () => void;
  onSaveRename: () => void;
  onMove: (folderId: number | null) => void;
  onDelete: () => void;
}) {
  return (
    <div className="tag-row">
      {renaming ? (
        <form
          className="tag-inline-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            onSaveRename();
          }}
        >
          <input
            className="tag-field"
            value={draft}
            autoFocus
            aria-label="Tag name"
            onChange={(event) => onChangeDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancelRename();
            }}
          />
          <button type="submit" className="tag-small-button" disabled={!draft.trim()}>
            Save
          </button>
        </form>
      ) : (
        <>
          <TagIcon size={14} aria-hidden />
          <span className="tag-name">{tag.name}</span>
          {folderName && <span className="tag-folder-label">{folderName}</span>}
          <span className="tag-usage">used by {tag.document_count}</span>
          <select
            className="tag-move-select"
            value={tag.pdf_tag_folder_id ?? ""}
            aria-label={`Folder of ${tag.name}`}
            title="Move to folder"
            onChange={(event) => onMove(event.target.value === "" ? null : Number(event.target.value))}
          >
            <option value="">Ungrouped</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ghost tag-row-action"
            title="Rename tag"
            aria-label={`Rename ${tag.name}`}
            onClick={onStartRename}
          >
            <Pencil size={13} aria-hidden />
          </button>
          <button
            type="button"
            className={`ghost tag-row-action${armed ? " is-danger" : ""}`}
            title={
              armed ? `Delete the tag from ${tag.document_count} documents` : "Delete tag"
            }
            aria-label={armed ? `Confirm deleting ${tag.name}` : `Delete ${tag.name}`}
            onClick={onDelete}
          >
            <Trash2 size={13} aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}
