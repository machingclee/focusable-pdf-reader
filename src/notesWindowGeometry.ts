/**
 * Where the "Notes of this PDF" window was last seen.
 *
 * `localStorage` rather than the backend: this is a per-display detail (a
 * position in screen pixels), not something that should follow the profile to
 * another machine, and the two windows share an origin so the notes window can
 * write what the main window reads when it reopens the window.
 *
 * Kept out of `prefs.ts` on purpose: `savePrefs` rewrites a fixed shape and
 * would drop a key it does not know about.
 */

const KEY = "notes-window-rect-v1";

/** Logical pixels, which is what the window APIs take and report back. */
export type NotesWindowRect = { x: number; y: number; width: number; height: number };

/** The floors `openNotesWindow` also sets, so a restored size is always usable. */
export const MIN_NOTES_WINDOW_WIDTH = 280;
export const MIN_NOTES_WINDOW_HEIGHT = 320;

/** The slice of `Storage` this module needs, so a test can pass a fake one. */
export type RectStorage = Pick<Storage, "getItem" | "setItem">;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** The stored rectangle, or `null` when there is none or it is not trustworthy. */
export function loadNotesWindowRect(storage?: RectStorage): NotesWindowRect | null {
  try {
    const raw = (storage ?? localStorage).getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const rect = parsed as Partial<NotesWindowRect>;
    if (!isFiniteNumber(rect.x) || !isFiniteNumber(rect.y)) return null;
    if (!isFiniteNumber(rect.width) || !isFiniteNumber(rect.height)) return null;
    // A window smaller than its own minimums cannot be dragged back to a usable
    // size without a resize the reader may not know how to do, so it is dropped
    // and the default is used instead.
    if (rect.width < MIN_NOTES_WINDOW_WIDTH || rect.height < MIN_NOTES_WINDOW_HEIGHT) return null;
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  } catch {
    // Invalid JSON, no storage, or a blocked origin: the default geometry wins.
    return null;
  }
}

export function saveNotesWindowRect(rect: NotesWindowRect, storage?: RectStorage): void {
  try {
    (storage ?? localStorage).setItem(KEY, JSON.stringify(rect));
  } catch {
    // Quota or private mode: the next window opens at the default size.
  }
}
