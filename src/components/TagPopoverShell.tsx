/**
 * The floating panel behind the three tag surfaces: the tag manager, the
 * assignment popover and the rail's tag filter.
 *
 * Portalled to the body for the same reason the context menus are: the Notes
 * tab, the docked columns and the popped-out window each bring a stacking
 * context and an `overflow` box, and a panel positioned inside one would be
 * clipped by it. In the body its coordinates are the viewport's, so the pointer
 * coordinates and the edge clamping mean the same thing everywhere.
 *
 * The shell owns what is easy to get subtly wrong and identical in all three
 * places: staying on screen next to its anchor, closing on an outside press,
 * Escape, or a scroll that is not the panel's own.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type TagPopoverAnchor = { element: HTMLElement | null } | { x: number; y: number };

const MARGIN = 8;

export function TagPopoverShell({
  anchor,
  label,
  width = 560,
  height,
  onClose,
  children,
}: {
  anchor: TagPopoverAnchor;
  /** Accessible name, e.g. "Tags". */
  label: string;
  width?: number;
  /** A fixed panel height; the lists inside then scroll instead of the panel growing. */
  height?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: MARGIN, top: MARGIN });

  // Below the anchor for a button, below the pointer for a right-click, and
  // never hanging off the window.
  //
  // The dependencies are the anchor's *values*, not the object: callers build the
  // anchor inline, so an object dependency would re-run the placement every
  // render, and its `setPosition` would schedule the next one — a loop.
  const anchorElement = "element" in anchor ? anchor.element : null;
  const anchorX = "x" in anchor ? anchor.x : null;
  const anchorY = "y" in anchor ? anchor.y : null;
  useLayoutEffect(() => {
    function place() {
      const panel = panelRef.current;
      const rect = anchorElement?.getBoundingClientRect() ?? null;
      const left = rect ? rect.left : anchorX ?? MARGIN;
      const top = rect ? rect.bottom + MARGIN : anchorY ?? MARGIN;
      const box = panel?.getBoundingClientRect();
      const panelWidth = box?.width ?? width;
      const panelHeight = box?.height ?? 0;
      const clampedLeft = Math.max(MARGIN, Math.min(left, window.innerWidth - panelWidth - MARGIN));
      const clampedTop = Math.max(
        MARGIN,
        Math.min(top, window.innerHeight - Math.min(panelHeight, window.innerHeight) - MARGIN),
      );
      setPosition({ left: clampedLeft, top: clampedTop });
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchorElement, anchorX, anchorY, width]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (panelRef.current?.contains(target)) return;
      // A row's right-click menu is portalled outside the panel but belongs to
      // it: without this, opening a menu would close the manager.
      if (target.closest("[role='menu'], [role='dialog'], [role='alertdialog']")) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // A panel pinned to coordinates that scrolled away is worse than no panel,
    // but scrolling a list inside the panel must not close it. Neither must
    // scrolling a row's menu: it is portalled outside the panel but belongs to
    // it, and a long one (the "Move to" list) scrolls rather than running off the
    // window.
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[role='menu']")) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      className="tags-popover"
      style={{ left: position.left, top: position.top, width, ...(height ? { height } : {}) }}
      role="dialog"
      aria-label={label}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
