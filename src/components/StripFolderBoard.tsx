/**
 * The folders of one document, the strips inside each folder, and the strips that
 * are in no folder.
 *
 * The "No folder" section sits below the folders and is not itself draggable: it
 * is the group a strip lands in when it is taken out of every folder, so it is a
 * drop target and a home for sortable strips like any folder.
 *
 * One DndContext covers all of it, because a strip can be reordered inside its
 * group or dragged to another one. Folder drags only collide with other folders.
 * Strip drags prefer the strip under the pointer, and fall through to the group
 * header when the pointer is on a header or an empty group.
 *
 * The overlay is portalled to `document.body` for the same reason the strip
 * context menu is: the docked notes column is `transform`ed, and a transformed
 * ancestor becomes the containing block for `position: fixed`. Left inline, the
 * preview would be positioned against the column and clipped by its overflow.
 */
import { useState, type ReactNode } from "react";
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
import type { FocusableStrip, FolderWithStrips } from "../types/dto";
import { planFolderReorder, planStripDrop, type StripGroup } from "../stripOrder";
import { startsDrag } from "./dnd/dragTarget";

/** Pointer travel, in px, before a press on a card or folder becomes a drag. */
const DRAG_DISTANCE_PX = 6;
import { SortableItem } from "./dnd/SortableItem";
import { FolderContextMenu } from "./FolderContextMenu";

export type StripFolderBoardProps = {
  folders: FolderWithStrips[];
  /** Strips that sit in no folder, in their own drag order. */
  unfiled: FocusableStrip[];
  /** Groups whose strips are hidden: folder ids, plus null for "No folder". */
  collapsed: ReadonlySet<number | null>;
  /** Open or close one group. */
  onToggleGroup: (id: number | null) => void;
  /** Open a group a strip was just dropped into, so it does not look lost. */
  onExpandGroup: (id: number | null) => void;
  onReorderFolders: (folderIds: number[]) => void;
  onReorderStrips: (groups: StripGroup[]) => void;
  onRenameFolder: (id: number, name: string) => void;
  onDeleteFolder: (id: number) => void;
  /** The strip card. The board supplies the drag slot it is dropped into. */
  renderStrip: (strip: FocusableStrip) => ReactNode;
};

type FolderDrag = { type: "folder"; folder: FolderWithStrips };
type StripDrag = { type: "strip"; strip: FocusableStrip };
/** The "No folder" section: a drop target with no folder behind it. */
type UnfiledDrag = { type: "unfiled" };

/** The droppable id of that section; no folder id can collide with it. */
const UNFILED_DROPPABLE_ID = "folder-droppable-unfiled";

function readDrag(data: unknown): FolderDrag | StripDrag | UnfiledDrag | null {
  if (!data || typeof data !== "object") return null;
  const record = data as { type?: unknown; folder?: FolderWithStrips; strip?: FocusableStrip };
  if (record.type === "folder" && record.folder) return { type: "folder", folder: record.folder };
  if (record.type === "strip" && record.strip) return { type: "strip", strip: record.strip };
  if (record.type === "unfiled") return { type: "unfiled" };
  return null;
}

const stripFolderCollision: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type;

  if (activeType === "folder") {
    const containers = args.droppableContainers.filter((container) => {
      const id = String(container.id);
      return id.startsWith("folder-") && !id.startsWith("folder-droppable-");
    });
    return closestCenter({ ...args, droppableContainers: containers });
  }

  // A strip under the pointer wins over the folder that contains it. The
  // folder droppable is what an empty folder, or the header, has to offer.
  const pointerHits = pointerWithin(args);
  const stripHit = pointerHits.find((hit) => String(hit.id).startsWith("strip-"));
  if (stripHit) return [stripHit];
  const folderHit = pointerHits.find((hit) => String(hit.id).startsWith("folder-droppable-"));
  if (folderHit) return [folderHit];

  // Keyboard drags have no pointer, so the nearest strip (then folder) is the target.
  const stripContainers = args.droppableContainers.filter((container) => String(container.id).startsWith("strip-"));
  const stripHits = closestCenter({ ...args, droppableContainers: stripContainers });
  if (stripHits[0]) return [stripHits[0]];
  const folderContainers = args.droppableContainers.filter((container) =>
    String(container.id).startsWith("folder-droppable-"),
  );
  return closestCenter({ ...args, droppableContainers: folderContainers }).slice(0, 1);
};

export function StripFolderBoard({
  folders,
  unfiled,
  collapsed,
  onToggleGroup,
  onExpandGroup,
  onReorderFolders,
  onReorderStrips,
  onRenameFolder,
  onDeleteFolder,
  renderStrip,
}: StripFolderBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Right-click menu on a folder header; the folder it acts on comes with it. */
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; folder: FolderWithStrips } | null>(null);

  // Cards and folder headers are their own activators, so a press only becomes a
  // drag once the pointer has moved: below that distance it is a click, and the
  // card's own controls (open the strip, edit the note, rename the folder) get it.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DISTANCE_PX } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeFolder =
    activeId === null
      ? null
      : (folders.find((folder) => `folder-${folder.id}` === activeId) ?? null);
  const activeStrip =
    activeId === null
      ? null
      : ([...folders.flatMap((folder) => folder.focusable_strips), ...unfiled].find(
          (strip) => `strip-${strip.id}` === activeId,
        ) ?? null);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;

    const activeDrag = readDrag(active.data.current);
    const overDrag = readDrag(over.data.current);
    if (!activeDrag || !overDrag) return;

    if (activeDrag.type === "folder") {
      if (overDrag.type !== "folder") return;
      const next = planFolderReorder(
        folders.map((folder) => folder.id),
        activeDrag.folder.id,
        overDrag.folder.id,
      );
      if (next) onReorderFolders(next);
      return;
    }

    if (activeDrag.type !== "strip") return;
    // The unfiled group travels as `id: null`, so the planner does not need to
    // know that "No folder" is a section rather than a folder.
    const groups = planStripDrop(
      [
        { id: null, strip_ids: unfiled.map((strip) => strip.id) },
        ...folders.map((folder) => ({
          id: folder.id,
          strip_ids: folder.focusable_strips.map((strip) => strip.id),
        })),
      ],
      activeDrag.strip.id,
      overDrag.type === "strip"
        ? { type: "strip", id: overDrag.strip.id }
        : { type: "folder", id: overDrag.type === "unfiled" ? null : overDrag.folder.id },
    );
    if (!groups) return;
    // The planner already knows where the strip landed; a closed folder there
    // would swallow it silently.
    const destination = groups.find((group) => group.strip_ids.includes(activeDrag.strip.id));
    if (destination) onExpandGroup(destination.folder_id);
    onReorderStrips(groups);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={stripFolderCollision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={folders.map((folder) => `folder-${folder.id}`)} strategy={verticalListSortingStrategy}>
        <ul className={`notes-strip-list${activeId ? " is-reordering" : ""}`}>
          {folders.map((folder) => (
            <SortableFolder
              key={folder.id}
              folder={folder}
              collapsed={collapsed.has(folder.id)}
              onToggleCollapsed={() => onToggleGroup(folder.id)}
              onRename={onRenameFolder}
              onDelete={onDeleteFolder}
              onOpenMenu={(x, y) => setFolderMenu({ x, y, folder })}
            >
              <SortableContext
                items={folder.focusable_strips.map((strip) => `strip-${strip.id}`)}
                strategy={verticalListSortingStrategy}
              >
                <div className="notes-folder-strips">
                  {folder.focusable_strips.map((strip) => (
                    <SortableItem key={strip.id} id={`strip-${strip.id}`} data={{ type: "strip", strip }}>
                      {renderStrip(strip)}
                    </SortableItem>
                  ))}
                </div>
              </SortableContext>
              {folder.focusable_strips.length === 0 && (
                <p className="notes-folder-empty">No strips in this folder.</p>
              )}
            </SortableFolder>
          ))}
          {/* Last, after the folders: it is where strips fall out of them, not a
              folder of its own. Always on screen, even empty, so the destination
              can be found before you need it. */}
          <UnfiledSection
            strips={unfiled}
            collapsed={collapsed.has(null)}
            dragging={activeStrip !== null}
            onToggleCollapsed={() => onToggleGroup(null)}
            renderStrip={renderStrip}
          />
        </ul>
      </SortableContext>

      {createPortal(
        <DragOverlay>
          {activeFolder ? (
            <div className="notes-drag-overlay">
              <div className="notes-folder-head">
                {/* Same slots in the same order as the row underneath: arrow,
                    icon, then the name. The arrow is never left out — taking it
                    away made the preview narrower than the row, so the icon and
                    the name jumped left for the whole drag and back on the drop. */}
                <GhostChevron collapsed={collapsed.has(activeFolder.id)} />
                <FolderIcon />
                <span className="notes-folder-name">{activeFolder.name}</span>
                <FolderTotal count={activeFolder.focusable_strips.length} />
              </div>
            </div>
          ) : activeStrip ? (
            <div className="notes-drag-overlay">{renderStrip(activeStrip)}</div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}

      {folderMenu && (
        <FolderContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          name={folderMenu.folder.name}
          stripCount={folderMenu.folder.focusable_strips.length}
          onClose={() => setFolderMenu(null)}
          onDelete={() => {
            const { folder } = folderMenu;
            setFolderMenu(null);
            onDeleteFolder(folder.id);
          }}
        />
      )}
    </DndContext>
  );
}

/**
 * The strips that sit in no folder.
 *
 * It is not a folder, so it cannot be dragged and cannot be renamed: it is the
 * group a strip lands in when it is taken out of every folder. It is on screen even when it
 * holds nothing, so the destination can be found before you need it; the only
 * thing the empty state adds is where a strip being dragged would land.
 */
function UnfiledSection({
  strips,
  collapsed,
  dragging,
  onToggleCollapsed,
  renderStrip,
}: {
  strips: FocusableStrip[];
  collapsed: boolean;
  /** A strip is being dragged, so the empty section is a live drop target. */
  dragging: boolean;
  onToggleCollapsed: () => void;
  renderStrip: (strip: FocusableStrip) => ReactNode;
}) {
  const droppable = useDroppable({ id: UNFILED_DROPPABLE_ID, data: { type: "unfiled" } });

  return (
    <li
      ref={droppable.setNodeRef}
      className={`notes-folder is-unfiled${droppable.isOver ? " is-drop-target" : ""}`}
    >
      <div className="notes-folder-head">
        <CollapseToggle expanded={!collapsed} label="No folder" onToggle={onToggleCollapsed} />
        <FolderIcon />
        <span className="notes-folder-name">No folder</span>
        <FolderTotal count={strips.length} />
      </div>
      {!collapsed && (
        <>
          <SortableContext items={strips.map((strip) => `strip-${strip.id}`)} strategy={verticalListSortingStrategy}>
            <div className="notes-folder-strips">
              {strips.map((strip) => (
                <SortableItem key={strip.id} id={`strip-${strip.id}`} data={{ type: "strip", strip }}>
                  {renderStrip(strip)}
                </SortableItem>
              ))}
            </div>
          </SortableContext>
          {strips.length === 0 && dragging && (
            <p className="notes-folder-empty">Drop here to take a strip out of its folder.</p>
          )}
        </>
      )}
    </li>
  );
}

function SortableFolder({
  folder,
  collapsed,
  onToggleCollapsed,
  onRename,
  onDelete,
  onOpenMenu,
  children,
}: {
  folder: FolderWithStrips;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
  /** Right-click on the header: viewport coordinates of the pointer. */
  onOpenMenu: (x: number, y: number) => void;
  children: ReactNode;
}) {
  const sortable = useSortable({
    id: `folder-${folder.id}`,
    data: { type: "folder", folder },
    animateLayoutChanges: (args) => {
      const { isSorting, wasDragging } = args;
      if (isSorting || wasDragging) return false;
      return defaultAnimateLayoutChanges(args);
    },
  });
  // A second id, so a strip can be dropped on the folder without the folder's
  // own sortable id stealing the collision.
  const droppable = useDroppable({
    id: `folder-droppable-${folder.id}`,
    data: { type: "folder", folder },
  });
  const setNodeRef = (node: HTMLElement | null) => {
    sortable.setNodeRef(node);
    droppable.setNodeRef(node);
    sortable.setActivatorNodeRef(node);
  };

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transform ? "none" : sortable.transition,
    opacity: sortable.isDragging ? 0 : 1,
    width: "100%",
    touchAction: "none",
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      // Only a closed folder is a sortable target: with its strips mounted it
      // would drag as one tall block, which is unreadable mid-sort.
      {...(collapsed ? sortable.attributes : {})}
      {...(collapsed ? sortable.listeners : {})}
      // After the spread, so this is the handler that runs. The header's own
      // controls (the chevron, the name being edited, Delete) keep their press.
      onPointerDown={
        collapsed
          ? (event) => {
              if (startsDrag(event.target)) sortable.listeners?.onPointerDown?.(event);
            }
          : undefined
      }
      className={`notes-folder${collapsed ? " is-collapsed" : ""}${
        droppable.isOver ? " is-drop-target" : ""
      }`}
    >
      <div
        className="notes-folder-head"
        // The drag only exists while the folder is closed, so say so where the
        // pointer would otherwise wonder why nothing happens.
        title={collapsed ? undefined : "Collapse the folder to drag it"}
        // Right-click on the header is the folder's menu. The strips underneath
        // host the strip menu, so the two never fight over a click.
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenMenu(event.clientX, event.clientY);
        }}
      >
        <CollapseToggle expanded={!collapsed} label={folder.name} onToggle={onToggleCollapsed} />
        <FolderIcon />
        <FolderName name={folder.name} onCommit={(name) => onRename(folder.id, name)} />
        <FolderTotal count={folder.focusable_strips.length} />
        {folder.focusable_strips.length === 0 && (
          <button
            type="button"
            className="notes-folder-delete"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onDelete(folder.id)}
          >
            Delete
          </button>
        )}
      </div>
      {/* The strips are unmounted while closed, which also takes them out of the
          drag order: nothing invisible should be a drop target. */}
      {!collapsed && children}
    </li>
  );
}

/**
 * The chevron that opens and closes one group. It is a button rather than a click
 * on the whole header, because the header is also the folder's handle and holds
 * the name being edited and the delete button.
 */
/**
 * How many strips a group holds, as "(3)" after its name.
 *
 * Nothing at zero: an empty folder and a folder of three are told apart by the
 * presence of the number, and "No folder (0)" on every document would be a label
 * for a state nobody asked about.
 */
function FolderTotal({ count }: { count: number }) {
  if (count === 0) return null;
  return <span className="notes-folder-count">({count})</span>;
}

function CollapseToggle({
  expanded,
  label,
  onToggle,
}: {
  expanded: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`notes-folder-toggle${expanded ? "" : " is-collapsed"}`}
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
      title={expanded ? "Collapse" : "Expand"}
      onClick={onToggle}
    >
      <ChevronDown aria-hidden="true" />
    </button>
  );
}

/**
 * The chevron as it appears in a drag preview.
 *
 * Not a button: the pointer is busy dragging. It exists for one reason — the
 * preview has to keep the row's slots, arrow included. Lifting a folder only to
 * have its arrow vanish moved the icon and the name left for the whole drag, and
 * back on the drop. Rendered, never mounted conditionally: that is what keeps the
 * two boxes the same size.
 */
function GhostChevron({ collapsed }: { collapsed: boolean }) {
  return (
    <span className={`notes-folder-toggle${collapsed ? " is-collapsed" : ""}`} aria-hidden="true">
      <ChevronDown />
    </span>
  );
}

function FolderIcon() {
  return (
    <span className="notes-folder-icon" aria-hidden="true">
      <Folder />
    </span>
  );
}

function FolderName({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <span
        className="notes-folder-name"
        title="Double-click to rename"
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDraft(name);
        }}
      >
        {name}
      </span>
    );
  }

  return (
    <input
      className="notes-folder-name-field"
      value={draft}
      autoFocus
      aria-label="Folder name"
      onPointerDown={(event) => event.stopPropagation()}
      // The rename field keeps the native menu: copy and paste is what a text
      // field's right-click is for, and the folder menu has nothing to add while
      // its name is being edited.
      onContextMenu={(event) => event.stopPropagation()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim();
        setDraft(null);
        if (next.length > 0 && next !== name) onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setDraft(null);
        }
      }}
    />
  );
}
