/**
 * The pin's own gesture: press, travel, drop.
 *
 * A pin is a handle by default, so a press on it is only the *possible* start of
 * a drag. Held still and released, it is a click on a mark, which does nothing;
 * the drag begins when the pointer travels, and letting go is what places it. That
 * distinction is what keeps a plain press from leaving a pin looking half-moved,
 * and it is why the press is held as a "maybe" here rather than in the page.
 *
 * The page under the pointer is found by asking what is drawn there
 * (`pagePointAt`), so a pin can be carried to the page beside it as easily as
 * across one. Off the paper the last place stands: a pointer in the dark beside a
 * page is not a place to put a pin, and clearing it would make the pin blink out
 * on the way past a gap.
 */
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { Annotation } from "../../types/dto";
import { clampAnnotationPoint } from "../../annotation";
import { pagePointAt } from "../../pdfPageGeometry";

/**
 * How far a press on a pin has to travel before it is a drag.
 *
 * A click on a pin is nothing (the editor is not on the left button any more), so
 * the press is held as a maybe until the hand actually moves. Three pixels is the
 * jitter of a deliberate click, and short of the smallest move anyone means.
 */
export const ANNOTATION_DRAG_SLOP_PX = 3;

/**
 * The pin in the reader's hand, while it is being dragged.
 *
 * One gesture: press the pin, move, release — and the release places it. There is
 * no second step, so there is no confirmation bar and no mode to enter from a menu;
 * `Escape` is the only way out that writes nothing.
 *
 * `target` is where the drag has left the piece, `offset` is where inside the pin the
 * press landed (in PDF points, so the piece does not jump into the hand), and
 * `saving` is the write the release started.
 */
export type AnnotationDrag = {
  annotation: Annotation;
  target: { page: number; point: { x: number; y: number } } | null;
  offset: { x: number; y: number };
  dragging: boolean;
  saving: boolean;
};

/** A left press on a pin, before it is anything. */
export type AnnotationPress = {
  annotation: Annotation;
  x: number;
  y: number;
};

export type PinGestureOptions = {
  move: AnnotationDrag | null;
  setMove: Dispatch<SetStateAction<AnnotationDrag | null>>;
  /** The move as the pointer handlers see it — they are installed once, and a
   * press that arrives mid-render must still know a move is in flight. */
  moveRef: { current: AnnotationDrag | null };
  press: AnnotationPress | null;
  setPress: Dispatch<SetStateAction<AnnotationPress | null>>;
  /** Put the pin down where the drag left it. */
  commit: (move: AnnotationDrag) => void;
  /** Pick the pin up again from where a previous drop left it. */
  grab: (clientX: number, clientY: number) => void;
  /** Begin dragging this row from where the press landed. */
  start: (annotation: Annotation, clientX: number, clientY: number) => void;
};

export function usePinGesture({
  move,
  setMove,
  moveRef,
  press,
  setPress,
  commit,
  grab,
  start,
}: PinGestureOptions): { movingId: number | null } {
  const movingId = move?.annotation.id ?? null;
  const dragging = move?.dragging === true;

  // Through refs: the pointer handlers are installed for the length of a gesture,
  // and their caller's arrows are new on every render — but a gesture must not be
  // torn down and rebuilt under the hand because the app re-rendered.
  const latest = useRef({ commit, grab, start });
  latest.current = { commit, grab, start };

  // Follow the pointer while a pin is in the hand; the release is the placement.
  useEffect(() => {
    if (movingId === null || !dragging) return;
    const endDrag = () => {
      const moving = moveRef.current;
      if (!moving || !moving.dragging) return;
      setMove((current) => (current ? { ...current, dragging: false } : current));
      latest.current.commit({ ...moving, dragging: false });
    };
    const onPointerMove = (event: PointerEvent) => {
      // A press released before this listener was attached would otherwise leave the
      // drag armed, and the pin would follow a pointer with no button on it.
      if (event.buttons === 0) {
        endDrag();
        return;
      }
      const hit = pagePointAt(event.clientX, event.clientY);
      if (!hit) return;
      setMove((current) => {
        if (!current || !current.dragging) return current;
        return {
          ...current,
          target: {
            page: hit.page,
            point: clampAnnotationPoint(
              hit.point.x + current.offset.x,
              hit.point.y + current.offset.y,
              hit.pageWidth,
              hit.pageHeight,
            ),
          },
        };
      });
    };
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", endDrag, true);
    window.addEventListener("pointercancel", endDrag, true);
    return () => {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", endDrag, true);
      window.removeEventListener("pointercancel", endDrag, true);
    };
  }, [dragging, moveRef, movingId, setMove]);

  /**
   * Decide what the press was.
   *
   * Travelled far enough: a drag. Lifted where it landed: nothing at all. A piece
   * that is already in a move (it was dropped and is being picked up again) keeps
   * the place it was left at instead of snapping back to its row.
   */
  useEffect(() => {
    const pressed = press;
    if (!pressed) return;
    const onMove = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < ANNOTATION_DRAG_SLOP_PX) {
        return;
      }
      setPress(null);
      const active = moveRef.current;
      if (active && active.annotation.id === pressed.annotation.id) {
        latest.current.grab(pressed.x, pressed.y);
        return;
      }
      latest.current.start(pressed.annotation, pressed.x, pressed.y);
    };
    const onUp = () => setPress(null);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  }, [moveRef, press, setPress]);

  return { movingId };
}
