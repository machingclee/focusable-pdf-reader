/**
 * The folders of one document, the strips inside each folder, and the strips that
 * are in no folder.
 *
 * The "No folder" section sits below the folders and is not itself draggable: it
 * is the group a strip lands in when it is taken out of every folder, so it is a
 * drop target and a home for sortable strips like any folder.
 *
 * One DndContext covers all of it, because a strip can be reordered inside its
 * group or dragged to another one. NoteFolder drags only collide with other folders.
 * Strip drags prefer the strip under the pointer, and fall through to the group
 * header when the pointer is on a header or an empty group.
 *
 * The overlay is portalled to `document.body` for the same reason the strip
 * context menu is: the docked notes column is `transform`ed, and a transformed
 * ancestor becomes the containing block for `position: fixed`. Left inline, the
 * preview would be positioned against the column and clipped by its overflow.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
import type { Note, NoteFolderWithNotes } from "../types/dto";
import { planFolderReorder, planStripDrop, type StripGroup } from "../stripOrder";
import { startsDrag } from "./dnd/dragTarget";

/** Pointer travel, in px, before a press on a card or folder becomes a drag. */
const DRAG_DISTANCE_PX = 6;

/** A toggle that is not available: the filtered list keeps every group open. */
const noop = () => undefined;

/**
 * How long a click on a folder's name waits before it opens or closes the folder.
 *
 * The name is a toggle like the rest of the row, and it is also one of the two ways
 * into the rename field (the other is "Rename folder" in the header's context menu,
 * which never touches the name and so needs no delay). A double-click arrives as two
 * clicks followed by `dblclick`, so a click that acted at
 * once would open the folder and then close it again on the way to the rename field.
 * Waiting this long lets the second press drop the first.
 *
 * Short on purpose: this is the wait the reader *feels* every time they open a folder
 * by its name, so it is kept under the double-click interval rather than matched to it
 * (the note badges in `App` use a longer 240ms, where what they delay is reading rather
 * than opening). The trade is that only a quick double-click renames; a leisurely one
 * lets the toggle fire first and the field opens with the folder already moved. That is
 * the cheaper of the two mistakes — a rename is rare next to opening a folder.
 */
const RENAME_CLICK_DELAY_MS = 100;

/**
 * How long a folder takes to open, in milliseconds.
 *
 * Short enough to be part of the click — the folded notes are on their way the moment
 * the row is pressed — and long enough that the eye reads it as the box growing rather
 * than the cards appearing whole. The shortest reveal in the app: a folder is a box
 * opening, not a panel sliding, and anything longer made the click feel answered late.
 * The chevron turns over its own 120ms, so the glyph settles a moment after the box;
 * the gap is small enough that the two still read as one gesture.
 */
const FOLDER_REVEAL_MS = 100;
import { SortableItem } from "./dnd/SortableItem";
import { FolderContextMenu } from "./FolderContextMenu";

export type StripFolderBoardProps = {
  folders: NoteFolderWithNotes[];
  /** Strips that sit in no folder, in their own drag order. */
  unfiled: Note[];
  /** Groups whose strips are hidden: folder ids, plus null for "No folder". */
  /** The groups the reader has opened; every other group is closed. */
  open: ReadonlySet<number | null>;
  /** Open or close one group. */
  onToggleGroup: (id: number | null) => void;
  /** Open a group a strip was just dropped into, so it does not look lost. */
  onExpandGroup: (id: number | null) => void;
  onReorderNoteFolders: (folderIds: number[]) => void;
  onReorderStrips: (groups: StripGroup[]) => void;
  onRenameNoteFolder: (id: number, name: string) => void;
  onDeleteNoteFolder: (id: number) => void;
  /** The strip card. The board supplies the drag slot it is dropped into. */
  renderStrip: (strip: Note) => ReactNode;
  /**
   * The list is narrowed by the notes filter.
   *
   * A narrowed list is a *reading* of the document, not its order: some notes are
   * not on screen, so a drop could only send the backend a reorder that moves the
   * hidden ones. Dragging is therefore off until the filter is cleared, and so is
   * folding — a matching card inside a closed folder would be a result the reader
   * cannot see. Every group stays open, with its chevron disabled rather than
   * silently doing nothing.
   */
  filtering?: boolean;
  /**
   * How many strips each folder really holds, when `filtering` narrowed `folders`.
   *
   * The header's own "(2)" is a result count and stays narrowed, but the folder
   * menu deletes the folder *and everything in it*: its confirmation has to count
   * the notes the filter is hiding, or the reader would arm a delete for two and
   * lose five.
   */
  stripTotals?: ReadonlyMap<number, number>;
};

type FolderDrag = { type: "folder"; folder: NoteFolderWithNotes };
type StripDrag = { type: "strip"; strip: Note };
/** The "No folder" section: a drop target with no folder behind it. */
type UnfiledDrag = { type: "unfiled" };

/** The droppable id of that section; no folder id can collide with it. */
const UNFILED_DROPPABLE_ID = "folder-droppable-unfiled";

function readDrag(data: unknown): FolderDrag | StripDrag | UnfiledDrag | null {
  if (!data || typeof data !== "object") return null;
  const record = data as { type?: unknown; folder?: NoteFolderWithNotes; strip?: Note };
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
  open,
  onToggleGroup,
  onExpandGroup,
  onReorderNoteFolders,
  onReorderStrips,
  onRenameNoteFolder,
  onDeleteNoteFolder,
  renderStrip,
  filtering = false,
  stripTotals,
}: StripFolderBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Right-click menu on a folder header; the folder it acts on comes with it. */
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; folder: NoteFolderWithNotes } | null>(null);
  /**
   * A folder whose name the menu asked to edit.
   *
   * The request has to travel as a token rather than a flag: the field closes
   * itself after a commit or an Escape, and the flag would still be up, so asking
   * to rename the same folder again would open nothing. A fresh token per ask
   * makes every ask a new request.
   */
  const [renameRequest, setRenameRequest] = useState<{ folderId: number; token: number } | null>(null);

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
      : ([...folders.flatMap((folder) => folder.notes), ...unfiled].find(
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
      if (next) onReorderNoteFolders(next);
      return;
    }

    if (activeDrag.type !== "strip") return;
    // The unfiled group travels as `id: null`, so the planner does not need to
    // know that "No folder" is a section rather than a folder.
    const groups = planStripDrop(
      [
        { id: null, note_ids: unfiled.map((strip) => strip.id) },
        ...folders.map((folder) => ({
          id: folder.id,
          note_ids: folder.notes.map((strip) => strip.id),
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
    const destination = groups.find((group) => group.note_ids.includes(activeDrag.strip.id));
    if (destination) onExpandGroup(destination.note_folder_id);
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
        <ul className={`notes-strip-list${activeId ? " is-reordering" : ""}${filtering ? " is-filtered" : ""}`}>
          {folders.map((folder) => (
            <SortableFolder
              key={folder.id}
              folder={folder}
              collapsed={!open.has(folder.id)}
              frozen={filtering}
              renameRequest={renameRequest?.folderId === folder.id ? renameRequest.token : null}
              onToggleCollapsed={() => onToggleGroup(folder.id)}
              onRename={onRenameNoteFolder}
              onDelete={onDeleteNoteFolder}
              onOpenMenu={(x, y) => setFolderMenu({ x, y, folder })}
            >
              <SortableContext
                items={folder.notes.map((strip) => `strip-${strip.id}`)}
                strategy={verticalListSortingStrategy}
              >
                <div className="notes-folder-strips">
                  {folder.notes.map((strip) => (
                    <SortableItem
                      key={strip.id}
                      id={`strip-${strip.id}`}
                      data={{ type: "strip", strip }}
                      disabled={filtering}
                    >
                      {renderStrip(strip)}
                    </SortableItem>
                  ))}
                </div>
              </SortableContext>
              {folder.notes.length === 0 && (
                <p className="notes-folder-empty">No strips in this folder.</p>
              )}
            </SortableFolder>
          ))}
          {/* Last, after the folders: it is where strips fall out of them, not a
              folder of its own. Always on screen, even empty, so the destination
              can be found before you need it — except while filtering, where an
              empty group is not a place to drop and has nothing to show. */}
          {(!filtering || unfiled.length > 0) && (
            <UnfiledSection
              strips={unfiled}
              collapsed={!open.has(null)}
              frozen={filtering}
              dragging={activeStrip !== null}
              onToggleCollapsed={() => onToggleGroup(null)}
              renderStrip={renderStrip}
            />
          )}
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
                <GhostChevron collapsed={!open.has(activeFolder.id)} />
                <FolderIcon />
                <span className="notes-folder-name">{activeFolder.name}</span>
                <FolderTotal count={activeFolder.notes.length} />
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
          stripCount={
            stripTotals?.get(folderMenu.folder.id) ?? folderMenu.folder.notes.length
          }
          onClose={() => setFolderMenu(null)}
          onRename={() => {
            const { folder } = folderMenu;
            setFolderMenu(null);
            // The token only has to differ from the last one, so it is counted off
            // the previous request instead of read from the clock.
            setRenameRequest((current) => ({ folderId: folder.id, token: (current?.token ?? 0) + 1 }));
          }}
          onDelete={() => {
            const { folder } = folderMenu;
            setFolderMenu(null);
            onDeleteNoteFolder(folder.id);
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
  frozen,
  dragging,
  onToggleCollapsed,
  renderStrip,
}: {
  strips: Note[];
  collapsed: boolean;
  /** The notes filter is on: the group is open and cannot be folded or dropped into. */
  frozen: boolean;
  /** A strip is being dragged, so the empty section is a live drop target. */
  dragging: boolean;
  onToggleCollapsed: () => void;
  renderStrip: (strip: Note) => ReactNode;
}) {
  const droppable = useDroppable({ id: UNFILED_DROPPABLE_ID, data: { type: "unfiled" }, disabled: frozen });

  return (
    <li
      ref={droppable.setNodeRef}
      // `is-collapsed` is the group's own state, not just the folder's: it is what
      // the stylesheet reads to shrink the box to its row. "No folder" is never
      // dragged (the style for that is scoped to real folders), but it does close.
      className={`notes-folder is-unfiled${collapsed ? " is-collapsed" : ""}${
        droppable.isOver ? " is-drop-target" : ""
      }`}
    >
      <div
        className="notes-folder-head"
        title={frozen ? "Every group is open while the notes are filtered" : collapsed ? "Click to expand" : "Click to collapse"}
        onClick={(event) => {
          if (frozen) return;
          // Its name is not editable, so the whole row is the target — only the
          // chevron is a control of its own.
          const target = event.target;
          if (target instanceof Element && target.closest(".notes-folder-toggle")) return;
          onToggleCollapsed();
        }}
      >
        <CollapseToggle expanded={!collapsed} label="No folder" disabled={frozen} onToggle={onToggleCollapsed} />
        <FolderIcon />
        <span className="notes-folder-name">No folder</span>
        <FolderTotal count={strips.length} />
      </div>
      {!collapsed && (
        <FolderBody>
          <SortableContext items={strips.map((strip) => `strip-${strip.id}`)} strategy={verticalListSortingStrategy}>
            <div className="notes-folder-strips">
              {strips.map((strip) => (
                <SortableItem
                  key={strip.id}
                  id={`strip-${strip.id}`}
                  data={{ type: "strip", strip }}
                  disabled={frozen}
                >
                  {renderStrip(strip)}
                </SortableItem>
              ))}
            </div>
          </SortableContext>
          {strips.length === 0 && dragging && (
            <p className="notes-folder-empty">Drop here to take a strip out of its folder.</p>
          )}
        </FolderBody>
      )}
    </li>
  );
}

function SortableFolder({
  folder,
  collapsed,
  frozen,
  renameRequest,
  onToggleCollapsed,
  onRename,
  onDelete,
  onOpenMenu,
  children,
}: {
  folder: NoteFolderWithNotes;
  collapsed: boolean;
  /** The notes filter is on: the row is a heading, not a handle or a fold control. */
  frozen: boolean;
  /** A fresh token when the menu asked to rename this folder; null when it did not. */
  renameRequest: number | null;
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
    disabled: frozen,
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
    disabled: frozen,
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
    // A frozen row is not a drag handle, so it must not claim the touch: the
    // folder's box is then a surface to scroll past like any other.
    touchAction: frozen ? undefined : "none",
  };

  /**
   * The name being edited, or null when the row is showing it as a label.
   *
   * It lives here rather than in `FolderName` because two gestures open the same
   * field: a double-click on the name, and the context menu's "Rename folder". The
   * second one never reaches the name at all, so the state cannot be the name's own.
   */
  const [edit, setEdit] = useState<{ value: string; selectAll: boolean } | null>(null);

  // The menu's rename arrives as a new token from the board. It opens the field on
  // the name the folder has now, with all of it selected: the reader who picked
  // "Rename folder" is replacing the name, not appending to it.
  useEffect(() => {
    if (renameRequest === null) return;
    setEdit({ value: folder.name, selectAll: true });
  }, [renameRequest]);

  return (
    <li
      ref={setNodeRef}
      style={style}
      // Only a closed folder is a sortable target: with its strips mounted it
      // would drag as one tall block, which is unreadable mid-sort. A filtered
      // list has no drag at all (`frozen`), so it takes neither the attributes
      // nor the listeners.
      {...(collapsed && !frozen ? sortable.attributes : {})}
      {...(collapsed && !frozen ? sortable.listeners : {})}
      // After the spread, so this is the handler that runs. The header's own
      // controls (the chevron, the name being edited, Delete) keep their press.
      onPointerDown={
        collapsed && !frozen
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
        // The whole row is the target: a click anywhere on it opens or closes the
        // folder, not just the chevron. A press that travels is a drag instead —
        // dnd-kit only activates past `DRAG_DISTANCE_PX`, and it stops the click
        // once it has — so reordering a closed folder still works from here.
        title={
          frozen
            ? "Open while the notes are filtered · clear the filter to fold them"
            : collapsed
              ? "Click to expand · drag to reorder"
              : "Click to collapse · collapse it to drag it"
        }
        onClick={(event) => {
          // A filtered row is a heading: its matches are the results, and folding
          // it would hide them.
          if (frozen) return;
          // Three controls inside the row are not the row: the chevron has its own
          // handler (this would otherwise toggle twice and appear to do nothing),
          // the name toggles on a delay of its own so a double-click can rename it,
          // and Delete deletes.
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest(".notes-folder-toggle, .notes-folder-name, .notes-folder-name-field, .notes-folder-delete")
          ) {
            return;
          }
          onToggleCollapsed();
        }}
        // Right-click on the header is the folder's menu. The strips underneath
        // host the strip menu, so the two never fight over a click.
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenMenu(event.clientX, event.clientY);
        }}
      >
        <CollapseToggle expanded={!collapsed} label={folder.name} disabled={frozen} onToggle={onToggleCollapsed} />
        <FolderIcon />
        <FolderName
          name={folder.name}
          edit={edit}
          frozen={frozen}
          onEdit={setEdit}
          onCommit={(name) => onRename(folder.id, name)}
          onToggleCollapsed={frozen ? noop : onToggleCollapsed}
        />
        <FolderTotal count={folder.notes.length} />
        {folder.notes.length === 0 && (
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
          drag order: nothing invisible should be a drop target. Mounting them is
          what the reveal animates. */}
      {!collapsed && <FolderBody>{children}</FolderBody>}
    </li>
  );
}

/**
 * The notes under a folder, revealed when the folder opens.
 *
 * The wrapper is mounted by the parent only while the folder is open, so every mount is
 * an expansion: the height is measured as the element takes it and animated down from
 * nothing, which is the one thing CSS cannot do here — a stack of cards has no known
 * height to transition to, and `height: auto` does not animate. Closing stays instant
 * (the element is simply gone), so nothing invisible is ever left in the drag order.
 *
 * `overflow: hidden` is what makes the intermediate heights clip instead of spill, but
 * it is only needed while the box is growing: at its measured height there is nothing
 * below the fold left to hide, and the clip lands exactly where the cards' shadows reach
 * past them. So the class that says the reveal is over turns the clip off
 * (`is-revealed`), and the cards can throw their shadow into the folder's own inset —
 * the space they were always given, and were never using.
 */
function FolderBody({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState(false);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    // An open is done the moment it is not animated: a reader who asked for less motion
    // (`prefers-reduced-motion`) gets the plain swap, and a box that measures zero — an
    // empty folder — has nothing to grow from. Both are open from the first frame, so
    // both are already un-clipped.
    const showAtOnce = () => setRevealed(true);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      showAtOnce();
      return;
    }

    // Measured, not `scrollHeight`: the first card's top margin is part of the space
    // under the folder's row, and a `scrollHeight` that left it out would end the
    // animation a few pixels short and then snap.
    const height = node.getBoundingClientRect().height;
    if (height === 0) {
      showAtOnce();
      return;
    }
    const animation = node.animate(
      [
        { height: "0px", opacity: 0 },
        { height: `${height}px`, opacity: 1 },
      ],
      { duration: FOLDER_REVEAL_MS, easing: "ease-out" },
    );
    // Rejection means the cleanup below cancelled it: the folder closed again before it
    // finished opening, and unmounted this wrapper with it.
    animation.finished.then(showAtOnce, () => undefined);
    return () => animation.cancel();
  }, []);

  return (
    <div className={`notes-folder-body${revealed ? " is-revealed" : ""}`} ref={ref}>
      {children}
    </div>
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
  disabled = false,
  onToggle,
}: {
  expanded: boolean;
  label: string;
  /** The notes filter is on: every group is open, so folding is not offered. */
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`notes-folder-toggle${expanded ? "" : " is-collapsed"}`}
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
      title={
        disabled
          ? "Every group is open while the notes are filtered"
          : expanded
            ? "Collapse"
            : "Expand"
      }
      disabled={disabled}
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

function FolderName({
  name,
  edit,
  frozen,
  onEdit,
  onCommit,
  onToggleCollapsed,
}: {
  name: string;
  /** The open field's draft, or null while the row shows the name as a label. */
  edit: { value: string; selectAll: boolean } | null;
  /** The notes filter is on: the name no longer opens or closes its folder. */
  frozen: boolean;
  /** Open the field, or close it when given null. */
  onEdit: (edit: { value: string; selectAll: boolean } | null) => void;
  onCommit: (name: string) => void;
  /** What a single click on the name does: the same open/close the row does. */
  onToggleCollapsed: () => void;
}) {
  /** The click waiting out `RENAME_CLICK_DELAY_MS`, if one is pending. */
  const clickTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    };
  }, []);

  if (edit === null) {
    return (
      <span
        className="notes-folder-name"
        title={
          frozen
            ? "Double-click to rename"
            : "Click to open or close · double-click to rename"
        }
        onClick={() => {
          // A filtered row is a heading, not a fold control: every group is open.
          if (frozen) return;
          // The row's own handler leaves the name alone (see `.notes-folder-head`),
          // so the toggle is this handler's job — and it has to be deferred, or the
          // second click of a double-click would toggle back before the rename
          // field opens.
          if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
          clickTimer.current = window.setTimeout(() => {
            clickTimer.current = null;
            onToggleCollapsed();
          }, RENAME_CLICK_DELAY_MS);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          // The rename wins the gesture: the toggle it interrupted does not happen.
          if (clickTimer.current !== null) {
            window.clearTimeout(clickTimer.current);
            clickTimer.current = null;
          }
          // A caret, not a selection: a double-click lands on the word, and the
          // reader may well be fixing one letter of it.
          onEdit({ value: name, selectAll: false });
        }}
      >
        {name}
      </span>
    );
  }

  return (
    <input
      className="notes-folder-name-field"
      value={edit.value}
      autoFocus
      aria-label="Folder name"
      onFocus={(event) => {
        // Only until the first keystroke: after that the selection is the reader's.
        if (edit.selectAll) event.currentTarget.select();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      // The rename field keeps the native menu: copy and paste is what a text
      // field's right-click is for, and the folder menu has nothing to add while
      // its name is being edited.
      onContextMenu={(event) => event.stopPropagation()}
      onChange={(event) => onEdit({ value: event.target.value, selectAll: false })}
      onBlur={() => {
        const next = edit.value.trim();
        onEdit(null);
        if (next.length > 0 && next !== name) onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onEdit(null);
        }
      }}
    />
  );
}
