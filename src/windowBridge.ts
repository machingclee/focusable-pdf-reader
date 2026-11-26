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
import { emit, emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { NotesWindowRect } from "./notesWindowGeometry";
import { IS_WINDOWS } from "./platform";
import type { Note } from "./types/dto";

export const MAIN_LABEL = "main";
export const NOTES_LABEL = "notes";

/**
 * A full second copy of the app, as opposed to a reference viewer.
 *
 * A reference window (`viewer-note-…`) is this app opened on one note. A window
 * with this prefix is the app itself again: no document yet, its own menu, its
 * own notes window. The label is unique, the same way a reference's is, so
 * opening another never focuses the one already there.
 */
export const APP_WINDOW_PREFIX = "app-";

/**
 * The label prefix of the viewer windows a note reference opens.
 *
 * One window per click: a reference is a link, and a link followed twice is two
 * places to read the same passage. The label is unique — a counter plus the
 * moment it was made — so a window is never mistaken for the one opened before
 * it, and nothing is ever focused instead of opened.
 *
 * The Rust side closes every window with this prefix when the main window goes:
 * see `src-tauri/src/lib.rs`.
 */
export const REFERENCE_VIEWER_PREFIX = "viewer-note-";

/**
 * The label prefix of a document opened in a window of its own.
 *
 * This is the documents column's "Open PDF in new window": the same viewer as a
 * reference window, on the document alone — nothing parked, nothing revealed.
 *
 * One window per document, unlike a reference (a link followed twice is two
 * looks at one passage): a PDF opened twice is the same reading, so the label is
 * the document's id and asking again raises the window that is already up. The
 * label is unique *across documents*, so two of them never collide.
 *
 * It is not in `REFERENCE_VIEWER_PREFIX`'s family on purpose: those windows are
 * looks at a passage the main window owns, so Rust closes them with it. A window
 * the reader opened to read a document is their own, and outlives the main
 * window the way File → Open in New Window does.
 */
export const DOCUMENT_VIEWER_PREFIX = "viewer-doc-";

export const NotesEvent = {
  /** notes → main: the window mounted (or reloaded); please send the context. */
  Ready: "notes:ready",
  /** main → notes: full snapshot, sent on every change. */
  Context: "notes:context",
  /** notes → main: the reader clicked a card; park the band on that strip. */
  OpenStrip: "notes:open-strip",
  /**
   * notes → main: show the note a `[note:<id>]` reference inside another note
   * points at.
   *
   * It has to travel: the referenced note can be in *another* PDF, and only the
   * main window can open one — resolve the document, read it, and ask the column
   * for the card. A same-document reference is revealed in the window it was
   * clicked in, without a round trip.
   */
  ShowNote: "notes:show-note",
  /** notes → main: the card a badge asked for has been placed. */
  RevealHandled: "notes:reveal-handled",
  /** notes → main: the new strip's remark field has taken the caret. */
  PendingEditHandled: "notes:pending-edit-handled",
  /**
   * either → every other window: your cache may be stale.
   *
   * A notification, not a payload: whichever window wrote something does not say
   * *what* it wrote — it cannot, without a second description of the endpoints —
   * so every window answers by invalidating everything it has cached
   * (`invalidateEveryTag`). `source` is the sender's label, and it is the only
   * thing the receiving side reads: a window does not need to refetch what it
   * just wrote.
   */
  CacheStale: "notes:cache-stale",
} as const;

/** What the detached panel needs to render; `document === null` means no storable PDF. */
export type NotesContext = {
  document: { filePath: string; documentName: string; pageCount?: number } | null;
  /** True when a PDF is open but has no path (opened from bytes). */
  pathless: boolean;
  revealId: number | null;
  pendingEditId: number | null;
};

/** What a cache-stale announcement carries: who sent it, so it can skip itself. */
export type CacheStalePayload = { source: string };

/** notes → main: park this strip in the viewer. */
export type OpenStripRequest = { strip: Note };

/**
 * The default this window is created with, before any size has been saved.
 * Matches the geometry module's floor, so a fresh window is always usable.
 */
const DEFAULT_NOTES_WIDTH = 380;
const DEFAULT_NOTES_HEIGHT = 760;

/** How far each additional reference window steps down and right, in px. */
const REFERENCE_CASCADE_PX = 26;
/** How many steps the cascade takes before the windows start sharing a corner. */
const MAX_REFERENCE_CASCADE = 3;
/** How large a reference viewer is, unless the display is smaller. */
const REFERENCE_VIEWER_WIDTH = 1100;
const REFERENCE_VIEWER_HEIGHT = 880;
/** Makes each reference viewer's label unique within a session. */
let referenceViewerSeq = 0;
/** Makes each File → Open in New Window unique within a session. */
let appWindowSeq = 0;
/** Set for the whole creation, so a shortcut and the menu cannot open two. */
let appWindowOpening = false;

/** The same size the main window is created with (`tauri.conf.json`). */
const APP_WINDOW_WIDTH = 1200;
const APP_WINDOW_HEIGHT = 860;

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

/**
 * The notes window that belongs to a viewer.
 *
 * The original window keeps the label `notes`. Every later copy of the app gets
 * its own, `notes-` plus that window's label, so popping the column out of one
 * does not replace the column another window already has open.
 */
export function notesWindowLabel(owner: string): string {
  return owner === MAIN_LABEL ? NOTES_LABEL : `notes-${owner}`;
}

/**
 * Which viewer a notes window reports back to.
 *
 * Read from the query string the window was created with. A missing owner is the
 * original window: that is the URL the first notes window has always had.
 */
export function notesOwnerLabel(search: string): string {
  const owner = new URLSearchParams(search).get("owner");
  return owner && owner.length > 0 ? owner : MAIN_LABEL;
}

export async function getNotesWindow(): Promise<WebviewWindow | null> {
  if (!isTauri()) return null;
  return WebviewWindow.getByLabel(notesWindowLabel(currentLabel()));
}

export async function getMainWindow(): Promise<WebviewWindow | null> {
  if (!isTauri()) return null;
  return WebviewWindow.getByLabel(MAIN_LABEL);
}

/** Emit to one window by label; resolves without a bridge. */
export function emitToWindow<T>(label: string, event: string, payload: T): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return emitTo(label, event, payload).catch((cause) => console.error(cause));
}

/**
 * Emit to the notes window that belongs to *this* viewer.
 *
 * A second copy of the app has its own notes window, so this must not always
 * be the original `notes` label.
 */
export function emitToNotes<T>(event: string, payload: T): Promise<void> {
  return emitToWindow(notesWindowLabel(currentLabel()), event, payload);
}

/** Emit to the main window only; resolves without a bridge. */
export function emitToMain<T>(event: string, payload: T): Promise<void> {
  return emitToWindow(MAIN_LABEL, event, payload);
}

/**
 * Tell every window that its cache may be stale.
 *
 * This is the whole cross-window protocol: a window that wrote something says so,
 * and the other windows refetch. Emitted to the app as a whole rather than to one
 * label, because the app has as many windows as the reader has notes open; the
 * `source` in the payload is how a window recognises its own announcement.
 *
 * With no other window open the emit lands nowhere, which costs nothing.
 */
export async function broadcastCacheStale(): Promise<void> {
  if (!isTauri()) return;
  try {
    await emit(NotesEvent.CacheStale, { source: currentLabel() } satisfies CacheStalePayload);
  } catch (cause) {
    // Losing one announcement only means the other windows are a refetch behind.
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

/** The options every "Notes of this PDF" window is created with. */
type NotesWindowOptions = ConstructorParameters<typeof WebviewWindow>[1];

function notesWindowOptions(url: string, rect: NotesWindowRect | null): NotesWindowOptions {
  return {
    // The same entry point as the main window; `main.tsx` picks the root from
    // the query string, so no second Vite page is needed.
    url,
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
  };
}

/**
 * The window frame, for the platform that does not hand one over.
 *
 * Every window this module opens draws its own title strip
 * (`src/components/TitleBar.tsx`), so on Windows none of them can keep the
 * system caption. `decorations: false` is what removes it — and it is set here
 * rather than in `tauri.conf.json` because these windows are not in the config
 * at all: they are created on demand, by this file.
 *
 * It costs nothing on Windows 11: the window keeps `WS_THICKFRAME`, so DWM still
 * rounds the corners, still draws the drop shadow, and the resize borders still
 * answer the pointer. `shadow` is stated rather than left to its default because
 * an undecorated window is the only case where it changes anything, and the
 * frame `src-tauri/src/win32.rs` then finishes needs it set.
 *
 * macOS keeps its decorations — they are the traffic lights — and gets the
 * overlay title bar from the options each caller already passes.
 */
const WINDOW_CHROME: NotesWindowOptions = IS_WINDOWS
  ? { decorations: false, shadow: true }
  : {};

/** Create a webview window and wait until the OS has it. */
async function createNotesWindow(label: string, options: NotesWindowOptions): Promise<WebviewWindow> {
  // The chrome last: a caller states what its window *is*, and the frame it
  // wears is not one of those choices.
  const win = new WebviewWindow(label, { ...options, ...WINDOW_CHROME });

  await new Promise<void>((resolve, reject) => {
    void win.once("tauri://created", () => resolve());
    void win.once("tauri://error", (event) => {
      reject(new Error(typeof event.payload === "string" ? event.payload : "could not create the notes window"));
    });
  });

  return win;
}

/**
 * Create (or re-focus) the "Notes of this PDF" window.
 *
 * It is not in `tauri.conf.json`: it exists only while the reader wants it
 * popped out, and it is created on demand so a session that never detaches never
 * pays for a second webview. The geometry is the last one this module saved.
 */
export async function openNotesWindow(rect: NotesWindowRect | null): Promise<WebviewWindow> {
  const owner = currentLabel();
  const label = notesWindowLabel(owner);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return existing;
  }
  const query = new URLSearchParams({ view: "notes", owner });
  return createNotesWindow(label, notesWindowOptions(`index.html?${query.toString()}`, rect));
}

/**
 * Where a new window sits so it is not exactly on top of the previous one.
 *
 * `occupied` is how many steps down and right it takes: a reference's first
 * window uses 0 and opens centred, and each one after steps. A new copy of the
 * app counts the original window too, so the first copy is already one step over.
 */
function cascadedOrigin(
  occupied: number,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const step = Math.min(occupied, MAX_REFERENCE_CASCADE) * REFERENCE_CASCADE_PX;
  const screen = {
    width: window.screen?.availWidth || 1440,
    height: window.screen?.availHeight || 900,
  };
  return {
    width,
    height,
    x: Math.round((screen.width - width) / 2) + step,
    y: Math.round((screen.height - height) / 2) + step,
  };
}

/**
 * Open another full copy of the app.
 *
 * This is File → Open in New Window (⌘N). The Dock's right-click item of the
 * same name opens this same window; that item is built in Rust (`dock_menu.rs`),
 * and the size and cascade step here are the ones that file uses.
 *
 * It is the same kind of window a note reference opens — another webview running
 * this app, with its own pages and its own store — without the reference's
 * document. A reference window is opened *on a note*. This one starts where the
 * app starts, and closing the original window leaves it up.
 *
 * The guard is synchronous on purpose: a second press while the window is still
 * being created would otherwise open two.
 */
export async function openAppWindow(): Promise<void> {
  if (!isTauri() || appWindowOpening) return;
  appWindowOpening = true;
  try {
    appWindowSeq += 1;
    const label = `${APP_WINDOW_PREFIX}${Date.now().toString(36)}-${appWindowSeq}`;
    const open = (await WebviewWindow.getAll()).filter((win) =>
      win.label.startsWith(APP_WINDOW_PREFIX),
    ).length;
    const screen = {
      width: window.screen?.availWidth || 1440,
      height: window.screen?.availHeight || 900,
    };
    const frame = cascadedOrigin(
      open + 1,
      Math.min(APP_WINDOW_WIDTH, Math.round(screen.width * 0.92)),
      Math.min(APP_WINDOW_HEIGHT, Math.round(screen.height * 0.9)),
    );
    await createNotesWindow(label, {
      url: "index.html",
      title: "PDF Focus Viewer",
      ...frame,
      minWidth: 720,
      minHeight: 480,
      titleBarStyle: "overlay",
      hiddenTitle: true,
      allowLinkPreview: false,
      focus: true,
    });
  } finally {
    appWindowOpening = false;
  }
}

/**
 * Open a viewer window on a note.
 *
 * This is what clicking a `[note:<id>]` reference does, from every view: a new
 * window showing the document that note belongs to, with the reading strip
 * parked on the note's band. It is the app's own viewer — the same pages, zoom,
 * rail and focus mode — so the note is read in place, in a window of its own,
 * and the main window is left exactly where the reader had it.
 *
 * Always a new window: the reference is a link to a passage, and following the
 * same link again is another look at it, not a request to find the window that
 * was already open. The labels are unique, so nothing collides and nothing is
 * silently focused instead of opened.
 */
export async function openReferenceViewerWindow(request: {
  filePath: string;
  noteId: number;
}): Promise<void> {
  if (!isTauri()) return;

  referenceViewerSeq += 1;
  const label = `${REFERENCE_VIEWER_PREFIX}${Date.now().toString(36)}-${referenceViewerSeq}`;
  const query = new URLSearchParams({
    view: "viewer",
    document: request.filePath,
    note: String(request.noteId),
  });

  // A window per reference is only useful while the reader can still see where
  // one ends and the next begins: each one steps down and right from the last,
  // up to a point, instead of opening exactly on top of it.
  const open = (await WebviewWindow.getAll()).filter((win) =>
    win.label.startsWith(REFERENCE_VIEWER_PREFIX),
  ).length;
  const screen = {
    width: window.screen?.availWidth || 1440,
    height: window.screen?.availHeight || 900,
  };
  const frame = cascadedOrigin(
    open,
    Math.min(REFERENCE_VIEWER_WIDTH, Math.round(screen.width * 0.72)),
    Math.min(REFERENCE_VIEWER_HEIGHT, Math.round(screen.height * 0.85)),
  );

  await createNotesWindow(label, {
    url: `index.html?${query.toString()}`,
    title: "PDF Focus Viewer",
    ...frame,
    minWidth: 480,
    minHeight: 420,
    titleBarStyle: "overlay",
    hiddenTitle: true,
    // Same as the main window: a note is not a link preview.
    allowLinkPreview: false,
    focus: true,
  });
}

/**
 * Open a document in a viewer window of its own.
 *
 * This is the documents column's "Open PDF in new window": the app's own viewer
 * on that document, with the page, the rail, zoom and focus mode, while the
 * window the reader was in keeps whatever it had open. They asked for a second
 * place to read the same file, so the notes column starts where the main
 * window's does — folded — rather than on the notes of a passage nobody named.
 *
 * One window per document rather than one per click: the label is the document's
 * id, so asking for a PDF that already has a window raises that window instead of
 * stacking a second identical one. A closed window is gone from the label list,
 * so the next request opens a fresh one.
 */
export async function openDocumentViewerWindow(request: {
  /** The library row the window is for; its id is the window's label. */
  documentId: number;
  filePath: string;
  /** Shown in the OS window list, which is how two of these are told apart. */
  documentName: string;
}): Promise<void> {
  if (!isTauri()) return;

  const label = `${DOCUMENT_VIEWER_PREFIX}${request.documentId}`;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  // No `note` in the query string: this window is about the document, which is
  // what `parseViewerRequest` reads as "nothing to park".
  const query = new URLSearchParams({ view: "viewer", document: request.filePath });

  // A reader who opens several documents gets a cascade, so each new window is
  // reachable instead of landing exactly on the last one.
  const open = (await WebviewWindow.getAll()).filter((win) =>
    win.label.startsWith(DOCUMENT_VIEWER_PREFIX),
  ).length;
  const screen = {
    width: window.screen?.availWidth || 1440,
    height: window.screen?.availHeight || 900,
  };
  const frame = cascadedOrigin(
    open,
    Math.min(APP_WINDOW_WIDTH, Math.round(screen.width * 0.82)),
    Math.min(APP_WINDOW_HEIGHT, Math.round(screen.height * 0.9)),
  );

  await createNotesWindow(label, {
    url: `index.html?${query.toString()}`,
    title: request.documentName || "PDF Focus Viewer",
    ...frame,
    minWidth: 720,
    minHeight: 480,
    titleBarStyle: "overlay",
    hiddenTitle: true,
    // Same as the main window: a document is not a link preview.
    allowLinkPreview: false,
    focus: true,
  });
}
