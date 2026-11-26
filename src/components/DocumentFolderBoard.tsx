/**
 * The Documents rail: real folders first, then Ungrouped pinned at the bottom.
 *
 * Ungrouped is not a folder row. A document is drawn there only while it has no
 * membership, and it is drawn in every real folder that files it. Dragging a
 * document from one folder onto another moves it: it joins the destination and
 * leaves the folder the row came from. Dragging it out of Ungrouped only files
 * it. Dragging onto Ungrouped removes the membership of the folder the row came
 * from.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  defaultAnimateLayoutChanges,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, Folder } from "lucide-react";
import { planFolderReorder, planSubsetReorder } from "../stripOrder";
import type { PdfDocumentListItem } from "../types/dto";
import { ContextMenu, ContextMenuDeleteItem, ContextMenuSeparator } from "./ContextMenu";
import { startsDrag } from "./dnd/dragTarget";
import { SortableItem } from "./dnd/SortableItem";

const DRAG_DISTANCE_PX = 6;

export type DocumentFolderSection = {
  id: number;
  name: string;
  documents: PdfDocumentListItem[];
};

type DocumentDrag = { type: "document"; documentId: number; sourceFolderId: number | null };
type FolderDrag = { type: "document-folder"; folderId: number };
type UngroupedDrag = { type: "ungrouped" };

function readDrag(data: unknown): DocumentDrag | FolderDrag | UngroupedDrag | null {
  if (!data || typeof data !== "object") return null;
  const record = data as {
    type?: unknown;
    documentId?: unknown;
    sourceFolderId?: unknown;
    folderId?: unknown;
  };
  if (record.type === "document" && typeof record.documentId === "number") {
    return {
      type: "document",
      documentId: record.documentId,
      sourceFolderId: typeof record.sourceFolderId === "number" ? record.sourceFolderId : null,
    };
  }
  if (record.type === "document-folder" && typeof record.folderId === "number") {
    return { type: "document-folder", folderId: record.folderId };
  }
  if (record.type === "ungrouped") return { type: "ungrouped" };
  return null;
}

const documentFolderCollision: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type;
  if (activeType === "document-folder") {
    const containers = args.droppableContainers.filter((container) => {
      const id = String(container.id);
      return id.startsWith("document-folder-") && !id.startsWith("document-folder-drop-");
    });
    return closestCenter({ ...args, droppableContainers: containers }).slice(0, 1);
  }

  const pointerHits = pointerWithin(args);
  const rowHit = pointerHits.find((hit) => String(hit.id).startsWith("doc-row-"));
  if (rowHit) return [rowHit];
  const folderHit = pointerHits.find((hit) => {
    const id = String(hit.id);
    return id.startsWith("document-folder-drop-") || id === "document-ungrouped-drop";
  });
  if (folderHit) return [folderHit];

  const rows = args.droppableContainers.filter((container) => String(container.id).startsWith("doc-row-"));
  const rowHits = closestCenter({ ...args, droppableContainers: rows });
  if (rowHits[0]) return [rowHits[0]];
  const drops = args.droppableContainers.filter((container) => {
    const id = String(container.id);
    return id.startsWith("document-folder-drop-") || id === "document-ungrouped-drop";
  });
  return closestCenter({ ...args, droppableContainers: drops }).slice(0, 1);
};

export function DocumentFolderBoard({
  folders,
  ungrouped,
  allDocumentIds,
  filtering,
  open,
  renamingFolderId,
  renderDocument,
  onToggle,
  onExpand,
  onReorderFolders,
  onReorderMembers,
  onAssign,
  onRemove,
  onReorderDocuments,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onDeleteFolder,
}: {
  folders: DocumentFolderSection[];
  ungrouped: PdfDocumentListItem[];
  /** Every document id, in the rail's ungrouped order. */
  allDocumentIds: number[];
  filtering: boolean;
  /** Groups the reader has opened. A folder that is not in here is closed. */
  open: ReadonlySet<number | "ungrouped">;
  renamingFolderId: number | null;
  renderDocument: (document: PdfDocumentListItem) => ReactNode;
  onToggle: (id: number | "ungrouped") => void;
  onExpand: (id: number | "ungrouped") => void;
  onReorderFolders: (ids: number[]) => void;
  onReorderMembers: (folderId: number, documentIds: number[]) => void;
  onAssign: (folderId: number, documentId: number) => void;
  onRemove: (folderId: number, documentId: number) => void;
  onReorderDocuments: (documentIds: number[]) => void;
  onBeginRename: (id: number) => void;
  onCommitRename: (id: number, name: string) => void;
  onCancelRename: () => void;
  onDeleteFolder: (id: number) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; folder: DocumentFolderSection } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DISTANCE_PX } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeFolder =
    activeId === null ? null : (folders.find((folder) => `document-folder-${folder.id}` === activeId) ?? null);
  // The overlay does not take the pointer, so the cursor is whatever sits under it.
  // A class on the page keeps the closed hand for the whole drag, including once
  // the heading has slid out from under the pointer.
  const draggingFolder = activeFolder !== null;
  useEffect(() => {
    if (!draggingFolder) return;
    document.body.classList.add("is-dragging-folder");
    return () => document.body.classList.remove("is-dragging-folder");
  }, [draggingFolder]);

  const activeDocument =
    activeId === null
      ? null
      : ([...folders.flatMap((folder) => folder.documents), ...ungrouped].find((document) =>
        activeId.endsWith(`-${document.id}`),
      ) ?? null);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (filtering || !over || active.id === over.id) return;
    const activeDrag = readDrag(active.data.current);
    const overDrag = readDrag(over.data.current);
    if (!activeDrag || !overDrag) return;

    if (activeDrag.type === "document-folder") {
      if (overDrag.type !== "document-folder") return;
      const next = planFolderReorder(
        folders.map((folder) => folder.id),
        activeDrag.folderId,
        overDrag.folderId,
      );
      if (next) onReorderFolders(next);
      return;
    }

    if (activeDrag.type !== "document") return;
    const sourceId = activeDrag.sourceFolderId;
    const sourceIds = sourceId === null
      ? ungrouped.map((document) => document.id)
      : (folders.find((folder) => folder.id === sourceId)?.documents.map((document) => document.id) ?? []);

    if (overDrag.type === "document" && overDrag.sourceFolderId === sourceId) {
      if (sourceId === null) {
        const next = planSubsetReorder(allDocumentIds, sourceIds, activeDrag.documentId, overDrag.documentId);
        if (next) onReorderDocuments(next);
      } else {
        const next = planFolderReorder(sourceIds, activeDrag.documentId, overDrag.documentId);
        if (next) onReorderMembers(sourceId, next);
      }
      return;
    }

    if (overDrag.type === "ungrouped" || (overDrag.type === "document" && overDrag.sourceFolderId === null)) {
      if (sourceId === null) return;
      const stillFiled = folders.some(
        (folder) => folder.id !== sourceId && folder.documents.some((document) => document.id === activeDrag.documentId),
      );
      onRemove(sourceId, activeDrag.documentId);
      if (!stillFiled && overDrag.type === "document") {
        const visible = [...ungrouped.map((document) => document.id), activeDrag.documentId];
        const next = planSubsetReorder(allDocumentIds, visible, activeDrag.documentId, overDrag.documentId);
        if (next) onReorderDocuments(next);
      }
      onExpand("ungrouped");
      return;
    }

    const destinationId = overDrag.type === "document-folder"
      ? overDrag.folderId
      : overDrag.type === "document"
        ? overDrag.sourceFolderId
        : null;
    if (destinationId === null || destinationId === sourceId) return;
    // A drag between folders is a move. Assigning alone would leave the document
    // in the folder it came from, so the same PDF would show up in both.
    onAssign(destinationId, activeDrag.documentId);
    if (sourceId !== null) onRemove(sourceId, activeDrag.documentId);
    onExpand(destinationId);
  };

  const visibleFolders = filtering ? folders.filter((folder) => folder.documents.length > 0) : folders;
  const showUngrouped = !filtering || ungrouped.length > 0;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={documentFolderCollision}
      onDragStart={(event: DragStartEvent) => {
        setActiveId(String(event.active.id));
        setMenu(null);
      }}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={visibleFolders.map((folder) => `document-folder-${folder.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <ul className={`notes-doc-list${activeId ? " is-reordering" : ""}`}>
          {visibleFolders.map((folder) => (
            <FolderSection
              key={folder.id}
              folder={folder}
              collapsed={!filtering && !open.has(folder.id)}
              filtering={filtering}
              renaming={renamingFolderId === folder.id}
              onToggle={() => onToggle(folder.id)}
              onRename={onCommitRename}
              onCancelRename={onCancelRename}
              onOpenMenu={(x, y) => setMenu({ x, y, folder })}
              renderDocument={renderDocument}
            />
          ))}
          {showUngrouped && (
            <UngroupedSection
              documents={ungrouped}
              collapsed={!filtering && !open.has("ungrouped")}
              filtering={filtering}
              dragging={activeDocument !== null}
              onToggle={() => onToggle("ungrouped")}
              renderDocument={renderDocument}
            />
          )}
        </ul>
      </SortableContext>

      {createPortal(
        <DragOverlay>
          {activeFolder ? (
            <div className="notes-drag-overlay">
              <div className="notes-folder-head">
                {/* Same slots, same order as the row: a missing chevron made the
                    icon and the name jump left for the drag and back on the drop. */}
                <GhostChevron />
                <span className="notes-folder-icon" aria-hidden><Folder size={16} /></span>
                <span className="notes-folder-name">{activeFolder.name}</span>
                <span className="notes-folder-count">({activeFolder.documents.length})</span>
              </div>
            </div>
          ) : activeDocument ? (
            <div className="notes-drag-overlay">{renderDocument(activeDocument)}</div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={`Actions for ${menu.folder.name}`}
          onClose={() => setMenu(null)}
        >
          <p className="strip-menu-note is-heading is-name-label" role="none">{menu.folder.name}</p>
          <button
            type="button"
            className="strip-menu-item"
            role="menuitem"
            onClick={() => {
              const folder = menu.folder;
              setMenu(null);
              onBeginRename(folder.id);
            }}
          >
            Rename folder
          </button>
          <ContextMenuSeparator />
          <ContextMenuDeleteItem
            label="Delete folder"
            armedLabel={
              menu.folder.documents.length > 0
                ? "Only an empty folder can be deleted — click again"
                : "Delete this folder — click again"
            }
            onConfirm={() => {
              const folder = menu.folder;
              setMenu(null);
              onDeleteFolder(folder.id);
            }}
          />
        </ContextMenu>
      )}
    </DndContext>
  );
}

function FolderSection({
  folder,
  collapsed,
  filtering,
  renaming,
  onToggle,
  onRename,
  onCancelRename,
  onOpenMenu,
  renderDocument,
}: {
  folder: DocumentFolderSection;
  collapsed: boolean;
  filtering: boolean;
  renaming: boolean;
  onToggle: () => void;
  onRename: (id: number, name: string) => void;
  onCancelRename: () => void;
  onOpenMenu: (x: number, y: number) => void;
  renderDocument: (document: PdfDocumentListItem) => ReactNode;
}) {
  const sortable = useSortable({
    id: `document-folder-${folder.id}`,
    data: { type: "document-folder", folderId: folder.id },
    disabled: filtering,
    animateLayoutChanges: (args) => {
      if (args.isSorting || args.wasDragging) return false;
      return defaultAnimateLayoutChanges(args);
    },
  });
  const droppable = useDroppable({
    id: `document-folder-drop-${folder.id}`,
    data: { type: "document-folder", folderId: folder.id },
    disabled: filtering,
  });
  const setNodeRef = (node: HTMLElement | null) => {
    sortable.setNodeRef(node);
    droppable.setNodeRef(node);
    sortable.setActivatorNodeRef(node);
  };
  // An open folder sorts as one tall block. Only a closed one is a handle, the
  // same rule as a notes folder: the source row fades and the overlay is the
  // only thing that follows the pointer.
  const draggable = collapsed && !filtering;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transform ? "none" : sortable.transition,
    opacity: sortable.isDragging ? 0 : 1,
    width: "100%",
    touchAction: draggable ? "none" : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`notes-folder${collapsed ? " is-collapsed" : ""}${droppable.isOver ? " is-drop-target" : ""}`}
      {...(draggable ? sortable.attributes : {})}
      {...(draggable ? sortable.listeners : {})}
      onPointerDown={
        draggable
          ? (event) => {
            if (startsDrag(event.target)) sortable.listeners?.onPointerDown?.(event);
          }
          : undefined
      }
    >
      <div
        className="notes-folder-head"
        title={
          filtering
            ? undefined
            : collapsed
              ? "Click to expand · drag to reorder"
              : "Click to collapse · collapse it to drag it"
        }
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenMenu(event.clientX, event.clientY);
        }}
        onClick={() => {
          if (!filtering && !renaming) onToggle();
        }}
      >
        <button
          type="button"
          className={`notes-folder-toggle${collapsed ? " is-collapsed" : ""}`}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${folder.name}`}
          disabled={filtering}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <ChevronDown aria-hidden />
        </button>
        <span className="notes-folder-icon" aria-hidden><Folder size={16} /></span>
        {renaming ? (
          <FolderRename name={folder.name} onSave={(name) => onRename(folder.id, name)} onCancel={onCancelRename} />
        ) : (
          <span className="notes-folder-name">{folder.name}</span>
        )}
        <span className="notes-folder-count">({folder.documents.length})</span>
      </div>

      {!collapsed && (
        <div className="notes-folder-body is-revealed">
          <SortableContext
            items={folder.documents.map((document) => `doc-row-${folder.id}-${document.id}`)}
            strategy={verticalListSortingStrategy}
          >
            {folder.documents.map((document) => (
              <SortableItem
                key={document.id}
                id={`doc-row-${folder.id}-${document.id}`}
                data={{ type: "document", documentId: document.id, sourceFolderId: folder.id }}
                disabled={filtering}
              >
                {renderDocument(document)}
              </SortableItem>
            ))}
          </SortableContext>
          {folder.documents.length === 0 && <p className="notes-folder-empty">This folder is empty.</p>}
        </div>
      )}
    </li>
  );
}

function UngroupedSection({
  documents,
  collapsed,
  filtering,
  dragging,
  onToggle,
  renderDocument,
}: {
  documents: PdfDocumentListItem[];
  collapsed: boolean;
  filtering: boolean;
  dragging: boolean;
  onToggle: () => void;
  renderDocument: (document: PdfDocumentListItem) => ReactNode;
}) {
  const droppable = useDroppable({
    id: "document-ungrouped-drop",
    data: { type: "ungrouped" },
    disabled: filtering,
  });
  return (
    <li
      ref={droppable.setNodeRef}
      className={`notes-folder is-unfiled${collapsed ? " is-collapsed" : ""}${droppable.isOver ? " is-drop-target" : ""}`}
    >
      <div className="notes-folder-head" onClick={() => { if (!filtering) onToggle(); }}>
        <button
          type="button"
          className={`notes-folder-toggle${collapsed ? " is-collapsed" : ""}`}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} Ungrouped`}
          disabled={filtering}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <ChevronDown aria-hidden />
        </button>
        <span className="notes-folder-name">Ungrouped</span>
        <span className="notes-folder-count">({documents.length})</span>
      </div>
      {!collapsed && (
        <div className="notes-folder-body is-revealed">
          <SortableContext
            items={documents.map((document) => `doc-row-ungrouped-${document.id}`)}
            strategy={verticalListSortingStrategy}
          >
            {documents.map((document) => (
              <SortableItem
                key={document.id}
                id={`doc-row-ungrouped-${document.id}`}
                data={{ type: "document", documentId: document.id, sourceFolderId: null }}
                disabled={filtering}
              >
                {renderDocument(document)}
              </SortableItem>
            ))}
          </SortableContext>
          {documents.length === 0 && dragging && (
            <p className="notes-folder-empty">Drop here to take a document out of its folder.</p>
          )}
          {documents.length === 0 && !dragging && <p className="notes-folder-empty">No ungrouped documents.</p>}
        </div>
      )}
    </li>
  );
}

/** The chevron in a drag preview: a span, so it keeps the row's first slot without being a button. */
function GhostChevron() {
  return (
    <span className="notes-folder-toggle is-collapsed" aria-hidden="true">
      <ChevronDown />
    </span>
  );
}

function FolderRename({ name, onSave, onCancel }: { name: string; onSave: (name: string) => void; onCancel: () => void }) {
  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        const field = new FormData(event.currentTarget as HTMLFormElement).get("name");
        const next = typeof field === "string" ? field.trim() : "";
        if (next) onSave(next);
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        name="name"
        className="notes-folder-name-field"
        aria-label="Folder name"
        defaultValue={name}
        autoFocus
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
    </form>
  );
}
