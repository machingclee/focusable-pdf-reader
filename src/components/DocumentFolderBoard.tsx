/**
 * The Documents rail: real folders first, then Ungrouped pinned at the bottom.
 *
 * Ungrouped is not a folder row. A document is drawn there only while it has no
 * membership, and it is drawn in every real folder that files it. Dragging a
 * document from one folder onto a document in another inserts it there, on the
 * upper or lower half of that row. While the drag lasts, a line marks that
 * edge. Dragging it onto a folder heading appends it. Either way it leaves
 * the folder the row came from. Dragging it out of Ungrouped only files it.
 * Dragging onto Ungrouped removes the membership of the folder the row came
 * from.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
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
  type Collision,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
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
import { planFolderReorder, planMemberInsert, planSubsetReorder } from "../stripOrder";
import { DRAG_SCROLL_EDGE_PX, dragScroller, edgeScrollStep, scrollByWheel } from "../dragScroll";
import type { PdfDocumentListItem } from "../types/dto";
import { ContextMenu, ContextMenuDeleteItem, ContextMenuSeparator } from "./ContextMenu";
import { startsDrag } from "./dnd/dragTarget";
import { SortableItem } from "./dnd/SortableItem";

const DRAG_DISTANCE_PX = 6;

/** The margin under a heading. Closer than this to the first PDF is the slot before it. */
const ROW_GAP_PX = 6;

type InsertMark = { folderId: number; index: number };
type InsertLine = { top: number; left: number; width: number };

type PointerDrag = Pick<DragEndEvent, "active" | "over" | "activatorEvent" | "delta">;

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

/**
 * The lower half of the row under the pointer inserts after that PDF.
 *
 * A keyboard drag has no pointer, so it inserts before the row it landed on.
 */
function droppedInLowerHalf(event: PointerDrag): boolean {
  const over = event.over;
  if (!over) return false;
  const mid = over.rect.top + over.rect.height / 2;
  const activator = event.activatorEvent;
  if ("clientY" in activator && typeof activator.clientY === "number") {
    return activator.clientY + event.delta.y > mid;
  }
  const translated = event.active.rect.current.translated;
  if (!translated) return false;
  return translated.top + translated.height / 2 > mid;
}

/**
 * The row a pointer in the gaps of an open folder is inserting against.
 *
 * The heading sits above the first PDF, and a drop there appends, so a pointer
 * that has not reached the rows returns null and the folder stays the target.
 */
function rowBesidePointer(
  args: Parameters<CollisionDetection>[0],
  folderDropId: unknown,
  activeKey: string,
): Collision | null {
  if (!args.pointerCoordinates) return null;
  const dropId = String(folderDropId);
  const prefix = "document-folder-drop-";
  if (!dropId.startsWith(prefix)) return null;
  const folderId = Number(dropId.slice(prefix.length));
  if (!Number.isInteger(folderId)) return null;

  const rowPrefix = `doc-row-${folderId}-`;
  let topmost = Infinity;
  let nearestId: Collision["id"] | null = null;
  let nearestDist = Infinity;
  for (const row of args.droppableContainers) {
    const id = String(row.id);
    if (!id.startsWith(rowPrefix) || id === activeKey) continue;
    const rect = args.droppableRects.get(row.id);
    if (!rect) continue;
    if (rect.top < topmost) topmost = rect.top;
    const bottom = rect.top + rect.height;
    const y = args.pointerCoordinates.y;
    const dist = y < rect.top ? rect.top - y : y > bottom ? y - bottom : 0;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestId = row.id;
    }
  }
  if (nearestId === null || topmost === Infinity) return null;
  if (args.pointerCoordinates.y < topmost - ROW_GAP_PX) return null;
  return { id: nearestId };
}

/** The slot the line should mark, or null when this drag is not entering another folder. */
function insertMarkFor(event: PointerDrag, folders: DocumentFolderSection[]): InsertMark | null {
  const activeDrag = readDrag(event.active.data.current);
  if (!activeDrag || activeDrag.type !== "document" || !event.over) return null;
  const overDrag = readDrag(event.over.data.current);
  if (!overDrag) return null;

  if (
    overDrag.type === "document"
    && overDrag.sourceFolderId !== null
    && overDrag.sourceFolderId !== activeDrag.sourceFolderId
  ) {
    const folder = folders.find((item) => item.id === overDrag.sourceFolderId);
    if (!folder) return null;
    const ids = folder.documents.map((document) => document.id);
    const next = planMemberInsert(ids, activeDrag.documentId, overDrag.documentId, droppedInLowerHalf(event));
    if (next) {
      const index = next.indexOf(activeDrag.documentId);
      return index < 0 ? null : { folderId: folder.id, index };
    }
    if (ids.includes(activeDrag.documentId)) return null;
    return { folderId: folder.id, index: ids.length };
  }

  if (overDrag.type === "document-folder" && overDrag.folderId !== activeDrag.sourceFolderId) {
    const folder = folders.find((item) => item.id === overDrag.folderId);
    if (!folder) return null;
    return { folderId: folder.id, index: folder.documents.length };
  }

  return null;
}

function pointerFromDrag(event: PointerDrag): { x: number; y: number } | null {
  const activator = event.activatorEvent;
  if (!("clientX" in activator) || !("clientY" in activator)) return null;
  if (typeof activator.clientX !== "number" || typeof activator.clientY !== "number") return null;
  return { x: activator.clientX + event.delta.x, y: activator.clientY + event.delta.y };
}

function sameLine(current: InsertLine | null, next: InsertLine | null): boolean {
  if (current === next) return true;
  if (!current || !next) return false;
  return Math.abs(current.top - next.top) < 0.5
    && Math.abs(current.left - next.left) < 0.5
    && Math.abs(current.width - next.width) < 0.5;
}

/** Where the insertion line is drawn. Rows that are not on screen fall back to the heading. */
function measureInsert(mark: InsertMark, folders: DocumentFolderSection[]): InsertLine | null {
  const folder = folders.find((item) => item.id === mark.folderId);
  if (!folder) return null;

  const anchor = (documentId: number) =>
    document.querySelector<HTMLElement>(`[data-doc-anchor="doc-row-${folder.id}-${documentId}"]`);
  const line = (rect: DOMRect, edge: "top" | "bottom"): InsertLine => ({
    top: edge === "top" ? rect.top : rect.bottom,
    left: rect.left,
    width: rect.width,
  });

  if (folder.documents.length > 0 && mark.index < folder.documents.length) {
    const node = anchor(folder.documents[mark.index]!.id);
    if (node) return line(node.getBoundingClientRect(), "top");
  }
  if (folder.documents.length > 0) {
    const last = folder.documents[folder.documents.length - 1];
    const node = last ? anchor(last.id) : null;
    if (node) return line(node.getBoundingClientRect(), "bottom");
  }

  const body = document.querySelector<HTMLElement>(`[data-doc-folder-body="${folder.id}"]`);
  if (body) return line(body.getBoundingClientRect(), "top");
  const head = document.querySelector<HTMLElement>(`[data-doc-folder="${folder.id}"] .notes-folder-head`);
  if (!head) return null;
  return line(head.getBoundingClientRect(), "bottom");
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
  // The dragged row follows the pointer, so it is usually the closest row. Skip
  // it, or a drop onto a PDF in another folder would count as a drop on itself.
  const activeKey = String(args.active.id);
  const rowHit = pointerHits.find((hit) => {
    const id = String(hit.id);
    return id.startsWith("doc-row-") && id !== activeKey;
  });
  if (rowHit) return [rowHit];
  const folderHit = pointerHits.find((hit) => {
    const id = String(hit.id);
    return id.startsWith("document-folder-drop-") || id === "document-ungrouped-drop";
  });
  if (folderHit) {
    const beside = rowBesidePointer(args, folderHit.id, activeKey);
    if (beside) return [beside];
    return [folderHit];
  }

  const rows = args.droppableContainers.filter((container) => {
    const id = String(container.id);
    return id.startsWith("doc-row-") && id !== activeKey;
  });
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
  /** `index` is where a new membership sits. Omit it to append. */
  onAssign: (folderId: number, documentId: number, index?: number) => void;
  onRemove: (folderId: number, documentId: number) => void;
  onReorderDocuments: (documentIds: number[]) => void;
  onBeginRename: (id: number) => void;
  onCommitRename: (id: number, name: string) => void;
  onCancelRename: () => void;
  onDeleteFolder: (id: number) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [insertLine, setInsertLine] = useState<InsertLine | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const insertMarkRef = useRef<InsertMark | null>(null);
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
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

  const trackInsert = (event: DragMoveEvent | DragOverEvent) => {
    const pointer = pointerFromDrag(event);
    if (pointer) pointerRef.current = pointer;
    const mark = insertMarkFor(event, folders);
    insertMarkRef.current = mark;
    const next = mark ? measureInsert(mark, folders) : null;
    setInsertLine((current) => (sameLine(current, next) ? current : next));
  };

  // The folders scroll inside the rail, not the window. Holding the pointer at
  // the rail's top or bottom edge keeps that box moving. A trackpad wheel lands
  // on the drag preview, which sits outside the rail, so that gesture is
  // forwarded onto the same box.
  useEffect(() => {
    if (activeId === null) return;
    const list = listRef.current;
    if (!list) return;
    const scroller = dragScroller(list) ?? list;

    const syncLine = () => {
      const mark = insertMarkRef.current;
      const next = mark ? measureInsert(mark, foldersRef.current) : null;
      setInsertLine((current) => (sameLine(current, next) ? current : next));
    };
    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };
    let frame = 0;
    const tick = () => {
      const pointer = pointerRef.current;
      if (pointer) {
        const rect = scroller.getBoundingClientRect();
        const top = Math.max(rect.top, 0);
        const bottom = Math.min(rect.bottom, window.innerHeight);
        const intoTop = top + DRAG_SCROLL_EDGE_PX - pointer.y;
        const intoBottom = pointer.y - (bottom - DRAG_SCROLL_EDGE_PX);
        if (intoTop > 0) scroller.scrollTop -= edgeScrollStep(intoTop);
        else if (intoBottom > 0) scroller.scrollTop += edgeScrollStep(intoBottom);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    const onWheel = (event: WheelEvent) => {
      if (scrollByWheel(event, scroller)) event.preventDefault();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    scroller.addEventListener("scroll", syncLine, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("wheel", onWheel, { capture: true });
      scroller.removeEventListener("scroll", syncLine);
    };
  }, [activeId]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setInsertLine(null);
    pointerRef.current = null;
    insertMarkRef.current = null;
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
    const destinationIds = folders
      .find((folder) => folder.id === destinationId)
      ?.documents.map((document) => document.id) ?? [];
    const alreadyThere = destinationIds.includes(activeDrag.documentId);
    // A drag between folders is a move. Assigning alone would leave the document
    // in the folder it came from, so the same PDF would show up in both. A drop
    // on a PDF lands on that row; a drop on the heading appends.
    if (overDrag.type === "document" && overDrag.sourceFolderId === destinationId) {
      const next = planMemberInsert(
        destinationIds,
        activeDrag.documentId,
        overDrag.documentId,
        droppedInLowerHalf(event),
      );
      if (next) {
        if (alreadyThere) onReorderMembers(destinationId, next);
        else onAssign(destinationId, activeDrag.documentId, next.indexOf(activeDrag.documentId));
      }
    } else if (!alreadyThere) {
      onAssign(destinationId, activeDrag.documentId);
    }
    if (sourceId !== null) onRemove(sourceId, activeDrag.documentId);
    onExpand(destinationId);
  };

  const visibleFolders = filtering ? folders.filter((folder) => folder.documents.length > 0) : folders;
  const showUngrouped = !filtering || ungrouped.length > 0;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={documentFolderCollision}
      autoScroll={false}
      onDragStart={(event: DragStartEvent) => {
        setActiveId(String(event.active.id));
        setInsertLine(null);
        pointerRef.current = null;
        insertMarkRef.current = null;
        setMenu(null);
      }}
      onDragMove={trackInsert}
      onDragOver={trackInsert}
      onDragCancel={() => {
        setActiveId(null);
        setInsertLine(null);
        pointerRef.current = null;
        insertMarkRef.current = null;
      }}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={visibleFolders.map((folder) => `document-folder-${folder.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <ul ref={listRef} className={`notes-doc-list${activeId ? " is-reordering" : ""}`}>
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
      {insertLine && createPortal(
        <div
          className="notes-doc-insert-line"
          style={{ top: insertLine.top, left: insertLine.left, width: insertLine.width }}
          aria-hidden="true"
        />,
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
      data-doc-folder={folder.id}
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
        <div className="notes-folder-body is-revealed" data-doc-folder-body={folder.id}>
          <SortableContext
            items={folder.documents.map((document) => `doc-row-${folder.id}-${document.id}`)}
            strategy={verticalListSortingStrategy}
          >
            {folder.documents.map((document) => (
              <SortableItem
                key={document.id}
                id={`doc-row-${folder.id}-${document.id}`}
                anchor={`doc-row-${folder.id}-${document.id}`}
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
