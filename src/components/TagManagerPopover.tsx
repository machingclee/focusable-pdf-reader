/**
 * The tag manager: the catalogue, and the folders that group it.
 *
 * Two panes, matching the reference project's Tags Manager: folders on the left
 * with a "+ Tag Folder" button over them, the selected folder's tags on the
 * right under a "+ Tag" button. Typing in the search box searches every tag, so
 * a tag filed in another folder is still one word away.
 *
 * Rows are plain until you right-click one: rename, move, delete and the two-click
 * delete confirm live in the row's context menu, which keeps the list itself
 * quiet. Dragging a folder row reorders the catalogue.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Folder as FolderIcon, GripVertical, Tag as TagIcon, X } from "lucide-react";
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
import { ContextMenu, ContextMenuDeleteItem } from "./ContextMenu";
import { SortableItem } from "./dnd/SortableItem";
import { TagNameForm } from "./TagNameForm";
import { TagPopoverShell, type TagPopoverAnchor } from "./TagPopoverShell";

type RowMenu = { kind: "folder" | "tag"; id: number; x: number; y: number };

export function TagManagerPopover({
  anchor,
  onClose,
}: {
  anchor: TagPopoverAnchor;
  onClose: () => void;
}) {
  const { data: tags = [], isLoading } = pdfTagApi.endpoints.listPdfTags.useQuery();
  const { data: folders = [] } = pdfTagApi.endpoints.listPdfTagFolders.useQuery();
  const [createFolder] = pdfTagApi.endpoints.createPdfTagFolder.useMutation();
  const [renameFolder] = pdfTagApi.endpoints.renamePdfTagFolder.useMutation();
  const [deleteFolder] = pdfTagApi.endpoints.deletePdfTagFolder.useMutation();
  const [reorderFolders] = pdfTagApi.endpoints.reorderPdfTagFolders.useMutation();
  const [createTag] = pdfTagApi.endpoints.createPdfTag.useMutation();
  const [updateTag] = pdfTagApi.endpoints.updatePdfTag.useMutation();
  const [deleteTag] = pdfTagApi.endpoints.deletePdfTag.useMutation();

  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  /** Whether the reader has chosen a folder yet; the first one is picked once. */
  const pickedFolder = useRef(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** The row whose name is being edited in place. */
  const [renaming, setRenaming] = useState<{ kind: "folder" | "tag"; id: number; draft: string } | null>(null);
  /** The row whose context menu is open, and where the pointer was. */
  const [menu, setMenu] = useState<RowMenu | null>(null);

  const searching = query.trim().length > 0;

  // Open on the first folder so the right pane has something in it, but only
  // once: after that the reader's choice (including Ungrouped) is kept.
  useEffect(() => {
    if (pickedFolder.current || folders.length === 0) return;
    pickedFolder.current = true;
    setSelectedFolderId(folders[0]?.id ?? null);
  }, [folders]);

  // A folder can disappear under the selection (deleted here or in another
  // window); fall back to Ungrouped rather than showing an empty pane.
  useEffect(() => {
    if (selectedFolderId !== null && !folders.some((folder) => folder.id === selectedFolderId)) {
      setSelectedFolderId(null);
    }
  }, [folders, selectedFolderId]);

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

  async function handleCreateTag(name: string) {
    const created = await run(() => createTag({ name, pdf_tag_folder_id: selectedFolderId }).unwrap());
    return created !== undefined;
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

  const menuTag = menu?.kind === "tag" ? tags.find((tag) => tag.id === menu.id) : undefined;

  return (
    <TagPopoverShell anchor={anchor} label="Tags" onClose={onClose} width={580} height="min(78vh, 560px)">
      <header className="tags-popover-head">
        <div>
          <p className="tags-popover-title">Tags</p>
          <p className="tags-popover-hint">Choose a folder, or search every tag.</p>
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

      <div className="tag-manager-body">
        <aside className="tag-pane" aria-label="Tag folders">
          <div className="tag-pane-toolbar">
            <TagNameForm
              placeholder="New folder name"
              submitLabel="Tag Folder"
              buttonClassName="tag-toolbar-button"
              onCreate={handleCreateFolder}
            />
          </div>

          <div className="tag-pane-list">
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
                    <div
                      className={`tag-folder-row${selectedFolderId === folder.id && !searching ? " is-selected" : ""}`}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setMenu({ kind: "folder", id: folder.id, x: event.clientX, y: event.clientY });
                      }}
                    >
                      <GripVertical size={14} className="tag-folder-grip" aria-hidden />
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
                        <button
                          type="button"
                          className="tag-folder-button"
                          onClick={() => {
                            setQuery("");
                            setSelectedFolderId(folder.id);
                          }}
                        >
                          <FolderIcon size={15} aria-hidden />
                          <span>{folder.name}</span>
                        </button>
                      )}
                    </div>
                  </SortableItem>
                ))}
              </SortableContext>
            </DndContext>

            <div className="tag-folder-divider" role="presentation" />

            <button
              type="button"
              className={`tag-folder-row tag-folder-ungrouped${selectedFolderId === null && !searching ? " is-selected" : ""}`}
              onClick={() => {
                setQuery("");
                setSelectedFolderId(null);
              }}
            >
              <FolderIcon size={15} aria-hidden />
              <span>Ungrouped</span>
            </button>
          </div>
        </aside>

        <section className="tag-pane" aria-label={searching ? "All tags" : "Tags in this folder"}>
          <div className="tag-pane-toolbar">
            <TagNameForm
              placeholder="New tag name"
              submitLabel="Tag"
              buttonClassName="tag-toolbar-button"
              onCreate={handleCreateTag}
            />
          </div>

          <div className="tag-pane-list">
            {isLoading && <p className="tags-empty">Loading…</p>}
            {!isLoading && visibleTags.length === 0 && (
              <p className="tags-empty">{searching ? "No matching tags." : "No tags here yet."}</p>
            )}
            {visibleTags.map((tag) => (
              <TagRow
                key={tag.id}
                tag={tag}
                folderName={searching ? folderNameFor(tag, folders) : null}
                renaming={renaming?.kind === "tag" && renaming.id === tag.id}
                draft={renaming?.kind === "tag" && renaming.id === tag.id ? renaming.draft : ""}
                onChangeDraft={(draft) => setRenaming({ kind: "tag", id: tag.id, draft })}
                onCancelRename={() => setRenaming(null)}
                onSaveRename={() => void handleRename()}
                onMenu={(x, y) => setMenu({ kind: "tag", id: tag.id, x, y })}
              />
            ))}
          </div>
        </section>
      </div>

      {error && (
        <footer className="tags-popover-foot">
          <span className="tags-error" role="alert">
            {error}
          </span>
        </footer>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.kind === "folder" ? "Tag folder actions" : "Tag actions"}
          onClose={() => setMenu(null)}
        >
          <button
            type="button"
            className="strip-menu-item"
            role="menuitem"
            onClick={() => {
              const row =
                menu.kind === "folder"
                  ? folders.find((folder) => folder.id === menu.id)
                  : tags.find((tag) => tag.id === menu.id);
              if (row) setRenaming({ kind: menu.kind, id: menu.id, draft: row.name });
              setMenu(null);
            }}
          >
            Rename
          </button>

          {menu.kind === "tag" && (
            <>
              <p className="strip-menu-note is-heading" role="none">
                Move to
              </p>
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className="strip-menu-item"
                  role="menuitem"
                  disabled={menuTag?.pdf_tag_folder_id === folder.id}
                  onClick={() => {
                    setMenu(null);
                    void run(() => updateTag({ id: menu.id, pdf_tag_folder_id: folder.id }).unwrap());
                  }}
                >
                  {folder.name}
                </button>
              ))}
              <button
                type="button"
                className="strip-menu-item"
                role="menuitem"
                disabled={menuTag?.pdf_tag_folder_id === null}
                onClick={() => {
                  setMenu(null);
                  void run(() => updateTag({ id: menu.id, pdf_tag_folder_id: null }).unwrap());
                }}
              >
                Ungrouped
              </button>
            </>
          )}

          <ContextMenuDeleteItem
            label={menu.kind === "folder" ? "Delete folder" : "Delete tag"}
            armedLabel={
              menu.kind === "folder"
                ? `Delete folder — its tags move to Ungrouped`
                : `Delete “${menuTag?.name ?? "tag"}” from ${menuTag?.document_count ?? 0} document${
                    menuTag?.document_count === 1 ? "" : "s"
                  } — click again`
            }
            onConfirm={() => {
              const kind = menu.kind;
              const id = menu.id;
              setMenu(null);
              void run(() => (kind === "folder" ? deleteFolder(id).unwrap() : deleteTag(id).unwrap()));
            }}
          />
        </ContextMenu>
      )}
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
  renaming,
  draft,
  onChangeDraft,
  onCancelRename,
  onSaveRename,
  onMenu,
}: {
  tag: PdfTag;
  /** Set only while searching: the flat list says which folder each tag is in. */
  folderName: string | null;
  renaming: boolean;
  draft: string;
  onChangeDraft: (draft: string) => void;
  onCancelRename: () => void;
  onSaveRename: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  return (
    <div
      className="tag-row"
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
    >
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
          <TagIcon size={15} aria-hidden />
          <span className="tag-name">{tag.name}</span>
          {folderName && <span className="tag-folder-label">{folderName}</span>}
        </>
      )}
    </div>
  );
}
