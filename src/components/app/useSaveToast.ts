/**
 * The confirmation line that clears itself.
 *
 * A save is confirmed where the menu that started it used to be, and the message
 * has no control to dismiss it: it is a receipt, not a dialog. So it lives for a
 * few seconds and goes, and a second message replaces the first rather than
 * queueing behind it — the newest write is the one worth reading.
 */
import { useEffect, useRef } from "react";

/** How long a receipt stays on screen. */
export const SAVE_TOAST_MS = 4000;

export type SaveToastOptions = {
  message: string | null;
  /** Clear it. Called with the timer, and never for a newer message. */
  clear: () => void;
};

export function useSaveToast({ message, clear }: SaveToastOptions): void {
  // Through a ref: the timer belongs to the message, and a caller that passes a
  // fresh arrow every render must not restart it on every render.
  const clearLatest = useRef(clear);
  clearLatest.current = clear;

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => clearLatest.current(), SAVE_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [message]);
}
