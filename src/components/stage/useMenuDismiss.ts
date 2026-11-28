/**
 * A menu that is anchored to something on the page must not outlive it.
 *
 * The band's menu is placed at the press that opened it, in viewport coordinates,
 * so nothing in the layout closes it for us: scroll the page, press anywhere else,
 * or press Escape, and the menu would stay where it was — pointing at a passage
 * that has moved out from under it, or at nothing at all. So it is closed on all
 * three, and on a press inside the menu's own shell (that press is the item being
 * chosen, which closes it by doing what it says).
 *
 * The scroller is watched rather than the window, because a column drag scrolls
 * the page without firing a window scroll event.
 */
import { useEffect, useRef, type RefObject } from "react";

export type MenuDismissOptions = {
  /** The menu is open. Closed, nothing is watched. */
  open: boolean;
  /** The menu's shell, so a press inside it is not the dismissal. */
  menuRef: RefObject<HTMLElement | null>;
  /** The page area: a scroll of it takes the menu's anchor away. */
  scrollerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
};

export function useMenuDismiss({ open, menuRef, scrollerRef, onClose }: MenuDismissOptions): void {
  // Through a ref: the watch belongs to the menu being open, and a caller that
  // passes a fresh arrow every render must not re-register it on every render.
  const closeLatest = useRef(onClose);
  closeLatest.current = onClose;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      closeLatest.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeLatest.current();
    };
    const onScroll = () => closeLatest.current();

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    const scroller = scrollerRef.current;
    scroller?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      scroller?.removeEventListener("scroll", onScroll);
    };
  }, [menuRef, open, scrollerRef]);
}
