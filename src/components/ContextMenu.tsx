/**
 * The floating menu shell behind every right-click menu in the notes view.
 *
 * It renders through a portal, which is not incidental. The docked notes column
 * floats over the page with a `transform` for its slide animation, and a
 * transformed ancestor becomes the containing block for `position: fixed`
 * children and clips them to its `overflow: hidden`. A menu left inside the
 * column would therefore be positioned against the column and cut off at its
 * edge — visibly different from the same menu in the Notes tab. Portalling to
 * `document.body` puts it back in the viewport's coordinate space, so both hosts
 * get the identical menu, and the pointer coordinates from the event are usable
 * as-is.
 *
 * The shell owns the parts that are easy to get subtly wrong: keeping the menu
 * on screen when the pointer is at the window edge, and closing on an outside
 * press, Escape, or a scroll (a menu pinned to coordinates that scrolled away is
 * worse than no menu). Callers only supply their items.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ContextMenuProps = {
  /** Viewport coordinates of the pointer. */
  x: number;
  y: number;
  /** Accessible name for the menu, e.g. "Folder actions". */
  label: string;
  onClose: () => void;
  children: ReactNode;
};

export function ContextMenu({ x, y, label, onClose, children }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the menu on screen: the pointer can be at the very edge, and a menu
  // hanging off the window is unusable.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    setPosition({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onScroll = () => onClose();

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [onClose]);

  return createPortal(
    <div className="strip-menu card-menu" ref={menuRef} style={position} role="menu" aria-label={label}>
      {children}
    </div>,
    document.body,
  );
}

export type ContextMenuDeleteItemProps = {
  /** The item as it reads before it is armed. */
  label: string;
  /** What it reads once armed, i.e. what the second click will do. */
  armedLabel: string;
  onConfirm: () => void;
};

/**
 * A destructive item that takes two clicks: the first arms it and says so, the
 * second acts.
 *
 * A right-click menu is one stray click away from lost work, so the destructive
 * item is the one place in this app that asks twice. Every menu with a delete in
 * it uses this item, so they all ask the same way.
 */
export function ContextMenuDeleteItem({ label, armedLabel, onConfirm }: ContextMenuDeleteItemProps) {
  const [armed, setArmed] = useState(false);

  return (
    <button
      type="button"
      className={`strip-menu-item${armed ? " is-danger" : ""}`}
      role="menuitem"
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        onConfirm();
      }}
    >
      {armed ? armedLabel : label}
    </button>
  );
}
