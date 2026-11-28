/**
 * The highlight pen's session: who holds the pen, across windows.
 *
 * A stroke in one window takes the pen in every window — a highlight is the
 * document's, and two people-near-each-other cursors drawing into the same file
 * would each think they were the only one. So the pen is not a `boolean` in this
 * component: it is a session in `stripHighlight`, which the other windows
 * subscribe to. Arming the pen claims it; putting it down, Escape, or a stroke
 * being finished elsewhere releases it (`onEscape` / `onClose` are how the app is
 * told to put its own pen down).
 *
 * The pen also owns the pointer's last place: `H` sizes the brush from the line
 * under the pointer, and a key press has no position of its own. That spot is
 * installed once for the window, here, because the pen is its only reader.
 *
 * A pen put down by any route takes its menu with it: the menu is the pen's
 * surface, and a menu left floating over the page belonged to a tool that is no
 * longer down.
 */
import { useEffect, useRef } from "react";
import { installPointerSpot } from "../../pointerSpot";
import { releaseHighlightSession, setHighlightSession } from "../../stripHighlight";

/**
 * This window's identity as a pen holder: the session id the reader's own pen
 * claims. Fixed, because the question is only ever "is it mine or another
 * window's".
 */
export const VIEWER_PEN_SESSION_ID = 0;

export type HighlightPenSessionOptions = {
  /** The pen is down in this window. */
  armed: boolean;
  /** The pen asked the app to put it down: Escape, or a stroke finished elsewhere. */
  onPutDown: () => void;
  /** A stroke's size changed (from the menu, or the pen's own readout). */
  onBrush: (pt: number) => void;
  /** The pen's menu is open; put it away when the pen goes down by any route. */
  closeMenu: () => void;
  /** The session id this window claims the pen under. */
  sessionId: number;
};

export function useHighlightPenSession({
  armed,
  onPutDown,
  onBrush,
  closeMenu,
  sessionId,
}: HighlightPenSessionOptions): void {
  // Through refs: claiming the pen is one transaction, and a caller passing fresh
  // arrows every render must not release and re-claim it on every render.
  const latest = useRef({ onPutDown, onBrush, closeMenu });
  latest.current = { onPutDown, onBrush, closeMenu };

  useEffect(() => installPointerSpot(), []);

  useEffect(() => {
    if (!armed) return;
    setHighlightSession({
      id: sessionId,
      onBrush: (pt) => latest.current.onBrush(pt),
      onEscape: () => latest.current.onPutDown(),
      onClose: () => latest.current.onPutDown(),
    });
    return () => releaseHighlightSession(sessionId);
  }, [armed, sessionId]);

  useEffect(() => {
    if (!armed) latest.current.closeMenu();
  }, [armed]);
}
