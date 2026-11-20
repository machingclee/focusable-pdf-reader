/**
 * The two windows this app can have, and the messages they pass.
 *
 * Each Tauri window is a separate webview: its own JS realm, React tree, Redux
 * store and RTK Query cache. Nothing is shared except the same-origin
 * `localStorage` and the backend, so the docked notes column and the window it
 * can be popped out into have to talk to each other explicitly.
 *
 * Two rules keep that conversation small:
 *
 * - The **main window owns the context** (which PDF is open, which strip a badge
 *   asked to see, which card should open its remark field). It pushes a snapshot
 *   whenever that changes, and again whenever the notes window says it is ready.
 * - The **backend owns the data**. Each window keeps its own cache; mutations
 *   forward their tag invalidations instead of their results.
 *
 * Every call here is a no-op outside Tauri, so the plain `vite` web build can
 * import this module and render the same components without a bridge.
 */
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { NotesWindowRect } from "./notesWindowGeometry";

export const MAIN_LABEL = "main";
export const NOTES_LABEL = "notes";

export const NotesEvent = {
  /** notes → main: the window mounted (or reloaded); please send the context. */
  Ready: "notes:ready",
  /** main → notes: full snapshot, sent on every change. */
  Context: "notes:context",
  /** notes → main: the reader clicked a card; park the band on that strip. */
  OpenStrip: "notes:open-strip",
  /** notes → main: the card a badge asked for has been placed. */
  RevealHandled: "notes:reveal-handled",
  /** notes → main: the new strip's remark field has taken the caret. */
  PendingEditHandled: "notes:pending-edit-handled",
  /** either → other: RTK tag types to invalidate. */
  Invalidate: "notes:invalidate",
} as const;

/** What the detached panel needs to render; `document === null` means no storable PDF. */
export type NotesContext = {
  document: { filePath: string; documentName: string; pageCount?: number } | null;
  /** True when a PDF is open but has no path (opened from bytes). */
  pathless: boolean;
  revealId: number | null;
  pendingEditId: number | null;
};

export type InvalidatePayload = { types: string[]; source: string };

/**
 * The default this window is created with, before any size has been saved.
 * Matches the geometry module's floor, so a fresh window is always usable.
 */
const DEFAULT_NOTES_WIDTH = 380;
const DEFAULT_NOTES_HEIGHT = 760;

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isNotesWindow(
  search: string = typeof window === "undefined" ? "" : window.location.search,
): boolean {
  return new URLSearchParams(search).get("view") === "notes";
}

/**
 * The label of the webview this code is running in.
 *
 * Read from Tauri's own metadata rather than from the URL, so a notes window
 * that was reloaded before its query string was parsed still knows what it is.
 * The URL is the fallback for the (impossible in the app) case of a webview with
 * no metadata, and it is what the unit tests exercise.
 */
export function currentLabel(): string {
  if (isTauri()) {
    try {
      return getCurrentWebviewWindow().label;
    } catch {
      // Fall through to the URL, which is always there.
    }
  }
  return isNotesWindow() ? NOTES_LABEL : MAIN_LABEL;
}

export async function getNotesWindow(): Promise<WebviewWindow | null> {
  if (!isTauri()) return null;
  return WebviewWindow.getByLabel(NOTES_LABEL);
}

export async function getMainWindow(): Promise<WebviewWindow | null> {
  if (!isTauri()) return null;
  return WebviewWindow.getByLabel(MAIN_LABEL);
}

/** Emit to the notes window only; resolves without a bridge. */
export function emitToNotes<T>(event: string, payload: T): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return emitTo(NOTES_LABEL, event, payload).catch((cause) => console.error(cause));
}

/** Emit to the main window only; resolves without a bridge. */
export function emitToMain<T>(event: string, payload: T): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return emitTo(MAIN_LABEL, event, payload).catch((cause) => console.error(cause));
}

/**
 * Forward a set of RTK tag types to the other window's cache.
 *
 * `emitTo` a label that does not exist is harmless, so this needs no existence
 * check: when the notes window is closed the invalidation has nowhere to go and
 * nobody to refetch for.
 */
export async function broadcastInvalidate(types: string[]): Promise<void> {
  if (!isTauri() || types.length === 0) return;
  const source = currentLabel();
  const target = source === NOTES_LABEL ? MAIN_LABEL : NOTES_LABEL;
  const payload: InvalidatePayload = { types, source };
  try {
    await emitTo(target, NotesEvent.Invalidate, payload);
  } catch (cause) {
    // Losing one invalidation only means the other window is a refetch behind.
    console.error(cause);
  }
}

/**
 * `listen` that is safe under StrictMode's double mount: the returned cleanup is
 * synchronous, so `useEffect(() => subscribe(…), [])` cannot leak a listener
 * whose registration was still in flight when the effect was torn down.
 *
 * The listener is registered against *this* webview's label rather than
 * globally. `emitTo(label, …)` reaches global listeners too — Tauri matches any
 * `Any`-targeted listener irrespective of the event's target — so a global
 * listener in the main window would also hear the messages main sends to the
 * notes window.
 */
export function subscribe<T>(event: string, handler: (payload: T) => void): () => void {
  if (!isTauri()) return () => {};
  let cancelled = false;
  let unlisten: UnlistenFn | undefined;
  void listen<T>(event, (received) => handler(received.payload), {
    target: { kind: "AnyLabel", label: currentLabel() },
  }).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/**
 * Snapshot guard: this payload crosses a process boundary, so it is parsed
 * rather than trusted.
 */
export function parseNotesContext(value: unknown): NotesContext | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<NotesContext>;

  const document = (candidate as { document?: unknown }).document;
  let parsedDocument: NotesContext["document"] = null;
  if (document !== null) {
    // A missing `document` is not the same as the explicit `null` the main
    // window sends for "no storable PDF", so it fails the guard.
    if (!document || typeof document !== "object") return null;
    const { filePath, documentName, pageCount } = document as {
      filePath?: unknown;
      documentName?: unknown;
      pageCount?: unknown;
    };
    if (typeof filePath !== "string" || filePath.length === 0) return null;
    if (typeof documentName !== "string") return null;
    if (pageCount !== undefined && (typeof pageCount !== "number" || !Number.isFinite(pageCount))) {
      return null;
    }
    parsedDocument = { filePath, documentName, ...(pageCount === undefined ? {} : { pageCount }) };
  }

  if (typeof candidate.pathless !== "boolean") return null;
  if (!isOptionalId(candidate.revealId)) return null;
  if (!isOptionalId(candidate.pendingEditId)) return null;

  return {
    document: parsedDocument,
    pathless: candidate.pathless,
    revealId: candidate.revealId ?? null,
    pendingEditId: candidate.pendingEditId ?? null,
  };
}

function isOptionalId(value: unknown): value is number | null | undefined {
  if (value === null || value === undefined) return true;
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Create (or re-focus) the "Notes of this PDF" window.
 *
 * It is not in `tauri.conf.json`: it exists only while the reader wants it
 * popped out, and it is created on demand so a session that never detaches never
 * pays for a second webview. The geometry is the last one this module saved.
 */
export async function openNotesWindow(rect: NotesWindowRect | null): Promise<WebviewWindow> {
  const existing = await getNotesWindow();
  if (existing) {
    await existing.setFocus();
    return existing;
  }

  const win = new WebviewWindow(NOTES_LABEL, {
    // The same entry point as the main window; `main.tsx` picks the root from
    // the query string, so no second Vite page is needed.
    url: "index.html?view=notes",
    title: "Notes of this PDF",
    width: rect?.width ?? DEFAULT_NOTES_WIDTH,
    height: rect?.height ?? DEFAULT_NOTES_HEIGHT,
    // Omitting both is what centres the window on the first launch.
    ...(rect ? { x: rect.x, y: rect.y } : {}),
    minWidth: 280,
    minHeight: 320,
    titleBarStyle: "overlay",
    hiddenTitle: true,
    // Same as the main window: a notes card is not a link preview.
    allowLinkPreview: false,
    focus: true,
  });

  await new Promise<void>((resolve, reject) => {
    void win.once("tauri://created", () => resolve());
    void win.once("tauri://error", (event) => {
      reject(new Error(typeof event.payload === "string" ? event.payload : "could not create the notes window"));
    });
  });

  return win;
}
