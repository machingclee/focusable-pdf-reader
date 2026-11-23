/**
 * The root of the popped-out "Notes of this PDF" window.
 *
 * It is the docked column, moved into a window of its own: the same
 * `DocumentNotesPanel`, the same cards and editors. What it does *not* own is the
 * context. The open PDF, the strip a badge asked to see and the card that should
 * take the caret all live in the main window, which pushes them here as a
 * snapshot (`NotesContext`); this window asks for one on mount and then follows
 * the changes.
 *
 * A `[note:<id>]` reference clicked here is the one thing this window does not
 * answer itself: showing a note means a viewer window of its own for the document
 * the note belongs to, and windows are opened by the viewer that popped this
 * column out.
 *
 * The data is a different matter: it comes from the backend, so this window
 * fetches it like any other host would, and the windows keep each other fresh by
 * forwarding tag invalidations rather than results.
 *
 * Two callbacks go the other way — "put the band on this strip" and "I have shown
 * what you asked for" — so the interaction still reads as if the column were
 * docked: clicking a card parks the strip in the main window, and a badge in the
 * main window brings this window forward.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
// `App.tsx` imports this too; this window never loads `App`, so it needs its own
// (Vite emits the stylesheet once for both entries).
import "./App.css";
import { BackendStatusBar } from "./components/BackendStatusBar";
import { DocumentNotesPanel } from "./components/DocumentNotesPanel";
import { WindowControls } from "./components/WindowControls";
import { PATHLESS_NOTES_MESSAGE } from "./notesPanel";
import { saveNotesWindowRect } from "./notesWindowGeometry";
import { highlightSessionKey } from "./stripHighlight";
import { panelShortcut } from "./shortcuts";
import { useHistoryShortcuts } from "./useHistoryShortcuts";
import { invalidateEveryTag } from "./store/cacheStale";
import { useAppDispatch } from "./store/hooks";
import type { FocusableStrip, FocusableStripWithDocument } from "./types/dto";
import {
  NotesEvent,
  currentLabel,
  emitToWindow,
  isTauri,
  notesOwnerLabel,
  parseNotesContext,
  subscribe,
  type CacheStalePayload,
  type NotesContext,
} from "./windowBridge";

/** How long after the last move/resize the rectangle is written. */
const GEOMETRY_SETTLE_MS = 300;

/** How long a status message stays before it clears itself, as in the main window. */
const TOAST_MS = 4000;

/* ── The window itself ────────────────────────────────────────────────────── */

/**
 * The chrome: the drag strip with the title, the column, the status toast and the
 * backend chip.
 *
 * The title strip is the window's handle (`data-tauri-drag-region="deep"`), the
 * same way the main window's is — there is no native title bar to drag.
 */
function NotesWindow({ title, toast, children }: { title: string; toast: string | null; children: ReactNode }) {
  useWindowGeometryPersistence();
  useCloseShortcut();

  return (
    <div className="app notes-window">
      <div className="titlebar notes-window-titlebar" data-tauri-drag-region="deep">
        <div className="titlebar-center">
          <span className="titlebar-title">{title}</span>
        </div>
        <WindowControls />
      </div>

      {children}

      {/* The main window's docked column uses the same toast for the same
          reasons; keeping it means a strip saved from here confirms itself in
          the window the reader is looking at. */}
      {toast && (
        <div className="save-toast" role="status">
          {toast}
        </div>
      )}

      <BackendStatusBar />
    </div>
  );
}

/* ── The popped-out column: it follows the main window ────────────────────── */

export default function DetachedNotesApp() {
  /** The viewer that popped this column out. A missing owner is the original window. */
  const owner = notesOwnerLabel(typeof window === "undefined" ? "" : window.location.search);
  /** That viewer's snapshot; `null` until the first one arrives. */
  const [context, setContext] = useState<NotesContext | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dispatch = useAppDispatch();

  // The panel's resizer is inert here, but the prop is not optional: the panel
  // measures it only when it is docked, which it never is in this window.
  const paneRef = useRef<HTMLElement | null>(null);

  useToastTimeout(toast, setToast);
  useRemoteInvalidations(dispatch);
  useHistoryShortcuts();

  useEffect(() => {
    return subscribe<NotesContext>(NotesEvent.Context, (payload) => {
      const next = parseNotesContext(payload);
      if (next) setContext(next);
    });
  }, []);

  // After the listeners above, so a `Ready` can never be answered into a
  // window that is not listening yet. A reload of this webview is a fresh mount,
  // and this is the main window's only way to know its snapshot went stale.
  useEffect(() => {
    void emitToWindow(owner, NotesEvent.Ready, null);
  }, [owner]);

  /** A card was clicked: the band belongs in the viewer that owns this column. */
  const onOpenStrip = useCallback((strip: FocusableStrip) => {
    void emitToWindow(owner, NotesEvent.OpenStrip, { strip });
  }, [owner]);

  /**
   * A `[note:<id>]` reference inside a note names a note, which is shown in a
   * window for *that* note's document. Opening windows belongs to the viewer
   * that owns this column, so the request goes there — even when the note is in
   * this document, because that viewer is the one that opens windows.
   */
  const onRevealNote = useCallback((strip: FocusableStripWithDocument) => {
    void emitToWindow(owner, NotesEvent.ShowNote, { strip });
  }, [owner]);

  const onPendingEditHandled = useCallback(() => {
    void emitToWindow(owner, NotesEvent.PendingEditHandled, null);
  }, [owner]);

  const onRevealHandled = useCallback(() => {
    void emitToWindow(owner, NotesEvent.RevealHandled, null);
  }, [owner]);

  const onDock = useCallback(() => {
    if (!isTauri()) return;
    void getCurrentWindow().close().catch((cause) => console.error(cause));
  }, []);

  const openDocument = context?.document ?? null;

  return (
    <NotesWindow title={openDocument?.documentName ?? "Notes of this PDF"} toast={toast}>
      {context === null ? (
        <p className="notes-message">Connecting to the viewer…</p>
      ) : openDocument === null ? (
        <p className="notes-message">
          {context.pathless ? PATHLESS_NOTES_MESSAGE : "Open a PDF to see its notes."}
        </p>
      ) : (
        <DocumentNotesPanel
          detached
          open
          paneRef={paneRef}
          width={0}
          onResizeStart={() => {}}
          filePath={openDocument.filePath}
          documentName={openDocument.documentName}
          pageCount={openDocument.pageCount}
          onOpenStrip={onOpenStrip}
          onRevealNote={onRevealNote}
          onStatus={setToast}
          pendingEditId={context.pendingEditId}
          onPendingEditHandled={onPendingEditHandled}
          revealId={context.revealId}
          onRevealHandled={onRevealHandled}
          onDock={onDock}
        />
      )}
    </NotesWindow>
  );
}

/* ── The window's own effects ─────────────────────────────────────────────── */

/** Remember where the window was, so the next one opens where this one was left. */
function useWindowGeometryPersistence() {
  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    let cancelled = false;
    let timer: number | undefined;
    const unlisteners: Array<() => void> = [];

    const persist = () => {
      void (async () => {
        try {
          const [position, size, scale] = await Promise.all([
            win.outerPosition(),
            win.innerSize(),
            win.scaleFactor(),
          ]);
          if (cancelled) return;
          // The window APIs report physical pixels; the saved rectangle is what
          // `openNotesWindow` passes back, and that is logical.
          const point = position.toLogical(scale);
          const viewport = size.toLogical(scale);
          saveNotesWindowRect({
            x: Math.round(point.x),
            y: Math.round(point.y),
            width: Math.round(viewport.width),
            height: Math.round(viewport.height),
          });
        } catch (cause) {
          // A window that is on its way out cannot be measured; the next one
          // opens at the default geometry.
          console.error(cause);
        }
      })();
    };

    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(persist, GEOMETRY_SETTLE_MS);
    };

    void (async () => {
      const [onMoved, onResized] = await Promise.all([win.onMoved(schedule), win.onResized(schedule)]);
      if (cancelled) {
        onMoved();
        onResized();
        return;
      }
      unlisteners.push(onMoved, onResized);
    })().catch((cause) => console.error(cause));

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      for (const unlisten of unlisteners) unlisten();
    };
  }, []);
}

/**
 * ⌘⌥B is the column's own chord in the main window; in one of these windows it
 * closes the window, the same way the traffic light does.
 *
 * The note dialog uses the same chord for its preview pane. The dialog is
 * recognised by being open: its preview pane takes no focus, so the press
 * often starts on the body rather than inside the dialog.
 */
function useCloseShortcut() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The pen on a preview. This window has no reading strip, so the brackets
      // would otherwise do nothing, and Escape is not the window's close key.
      if (highlightSessionKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (panelShortcut(event) !== "notes-panel") return;
      if (document.querySelector(".note-backdrop")) return;
      event.preventDefault();
      event.stopPropagation();
      if (!isTauri()) return;
      void getCurrentWindow().close().catch((cause) => console.error(cause));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

/** A status message that clears itself, as the main window's does. */
function useToastTimeout(toast: string | null, setToast: (value: string | null) => void) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast, setToast]);
}

/**
 * Answer the other windows' cache-stale announcements.
 *
 * The message is emitted to the app as a whole — this window is one of as many
 * webviews as the reader has open — so the sender's label is checked first: its
 * own store already holds the effects of its own write. What arrives is a bare
 * notification, so the answer is the blunt one: every tag type goes stale and
 * RTK Query refetches whatever this window is showing.
 */
function useRemoteInvalidations(dispatch: ReturnType<typeof useAppDispatch>) {
  useEffect(
    () =>
      subscribe<CacheStalePayload>(NotesEvent.CacheStale, (payload) => {
        if (payload.source === currentLabel()) return;
        invalidateEveryTag(dispatch);
      }),
    [dispatch],
  );
}
