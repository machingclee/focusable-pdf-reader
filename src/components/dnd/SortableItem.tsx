import type { ReactNode } from "react";
import { defaultAnimateLayoutChanges, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { startsDrag } from "./dragTarget";

/**
 * One vertical sortable row. The row itself is what the pointer grabs — there is
 * no grip — so the card inside is dragged by any part of it.
 *
 * A press that a child needs for itself (a text field) is filtered out by
 * `startsDrag`; everything else — the note's text, and the strip's preview too —
 * starts a drag after the pointer has moved far enough to not be a click (see
 * the sensors in `StripFolderBoard`), which is what keeps a click on the preview
 * opening the strip. A picture in the note is one of the exceptions: dragging
 * it resizes the picture.
 *
 * Layout animation is suppressed while a drag is sorting, and the source row goes
 * to opacity 0 (it keeps its slot) so only the overlay is visible.
 * `touchAction: none` stops the list from scrolling away with the pointer.
 *
 * `disabled` is the notes filter's: a narrowed list has rows that are visible but
 * not in their full order, so dragging one could only send the backend an order
 * with the hidden notes moved somewhere arbitrary. The row keeps its markup and
 * its slot, and stops being a handle.
 */
export function SortableItem({
  id,
  data,
  disabled = false,
  children,
}: {
  id: string;
  data: object;
  /** Rendered, but not draggable: the list is narrowed by a filter. */
  disabled?: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data,
    disabled,
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
    touchAction: disabled ? undefined : "none",
  };

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setActivatorNodeRef(node);
      }}
      style={style}
      {...(disabled ? {} : attributes)}
      {...(disabled ? {} : listeners)}
      // After the spread, so this is the handler that runs: dnd-kit's own
      // pointer listener only fires where the row owns the press.
      onPointerDown={
        disabled
          ? undefined
          : (event) => {
              if (startsDrag(event.target)) listeners?.onPointerDown?.(event);
            }
      }
      className="notes-sortable-row"
    >
      {children}
    </div>
  );
}
