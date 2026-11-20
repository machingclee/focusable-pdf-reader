import type { ReactNode } from "react";
import { defaultAnimateLayoutChanges, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { startsDrag } from "./dragTarget";

/**
 * One vertical sortable row. The row itself is what the pointer grabs — there is
 * no grip — so the card inside is dragged by any part of it.
 *
 * A press that a child needs for itself (a text field) is filtered out by
 * `startsDrag`; everything else — the note, and the strip's preview too — starts
 * a drag after the pointer has moved far enough to not be a click (see the
 * sensors in `StripFolderBoard`), which is what keeps a click on the preview
 * opening the strip.
 *
 * Layout animation is suppressed while a drag is sorting, and the source row goes
 * to opacity 0 (it keeps its slot) so only the overlay is visible.
 * `touchAction: none` stops the list from scrolling away with the pointer.
 */
export function SortableItem({
  id,
  data,
  children,
}: {
  id: string;
  data: object;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data,
    animateLayoutChanges: (args) => {
      const { isSorting, wasDragging } = args;
      if (isSorting || wasDragging) return false;
      return defaultAnimateLayoutChanges(args);
    },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transform ? "none" : transition,
    opacity: isDragging ? 0 : 1,
    width: "100%",
    touchAction: "none",
  };

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setActivatorNodeRef(node);
      }}
      style={style}
      {...attributes}
      {...listeners}
      // After the spread, so this is the handler that runs: dnd-kit's own
      // pointer listener only fires where the row owns the press.
      onPointerDown={(event) => {
        if (startsDrag(event.target)) listeners?.onPointerDown?.(event);
      }}
      className="notes-sortable-row"
    >
      {children}
    </div>
  );
}
