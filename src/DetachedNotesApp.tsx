/**
 * The root of the popped-out "Notes of this PDF" window.
 *
 * It is the docked column, moved into a window of its own: the same
 * `DocumentNotesPanel`, the same strip list, the same cards and editors. What it
 * does *not* own is the context. The open PDF, the strip a badge asked to see and
 * the card that should take the caret all live in the main window, which pushes
 * them here as a snapshot (`NotesContext`); this window asks for one on mount and
 * then follows the changes.
 *
 * The data is a different matter: it comes from the backend, so this window
 * fetches it like any other host would, and the two windows keep each other fresh
 * by forwarding tag invalidations rather than results.
 *
 * Two callbacks go the other way — "put the band on this strip" and "I have shown
 * what you asked for" — so the interaction still reads as if the column were
 * docked: clicking a card parks the strip in the main window, and a badge in the
 * main window brings this window forward.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
// `App.tsx` imports this too; this window never loads `App`, so it needs its own
// (Vite emits the stylesheet once for both entries).
import "./App.css";
import { BackendStatusBar } from "./components/BackendStatusBar";
import { DocumentNotesPanel } from "./components/DocumentNotesPanel";
import { PATHLESS_NOTES_MESSAGE } from "./notesPanel";
import { saveNotesWindowRect } from "./notesWindowGeometry";
import { panelShortcut } from "./shortcuts";
import { applyRemoteInvalidation } from "./store/crossWindowSync";
import { useAppDispatch } from "./store/hooks";
import type { FocusableStrip } from "./types/dto";
import {
  NotesEvent,
  emitToMain,
  isTauri,
  parseNotesContext,
  subscribe,
  type InvalidatePayload,
  type NotesContext,
} from "./windowBridge";

/** How long after the last move/resize the rectangle is written. */
const GEOMETRY_SETTLE_MS = 300;

/** How long a status message stays before it clears itself, as in the main window. */
const TOAST_MS = 4000;

export default function DetachedNotesApp() {
  /** The main window's snapshot; `null` until the first one arrives. */
  const [context, setContext] = useState<NotesContext | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const dispatch = useAppDispatch();

  // The panel's resizer is inert here, but the prop is not optional: the panel
  // measures it only when it is docked, which it never is in this window.
  const paneRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    return subscribe<NotesContext>(NotesEvent.Context, (payload) => {
      const next = parseNotesContext(payload);
      if (next) setContext(next);
    });
  }, []);

  useEffect(
    () => subscribe<InvalidatePayload>(NotesEvent.Invalidate, (payload) => applyRemoteInvalidation(dispatch, payload.types)),
    [dispatch],
  );

  // After the listeners above, so a `Ready` can never be answered into a
  // window that is not listening yet. A reload of this webview is a fresh mount,
  // and this is the main window's only way to know its snapshot went stale.
  useEffect(() => {
    void emitToMain(NotesEvent.Ready, null);
  }, []);

  // Remember where the window was, so the next pop-out opens where this one was
  // left. Debounced: dragging a window emits a move per frame.
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

  // ⌘⌥M is the column's own chord in the main window; here it puts the column
  // back. Closing goes through the same path as the traffic light, so the main
  // window's `tauri://destroyed` handler docks the panel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (panelShortcut(event) !== "notes-panel") return;
      event.preventDefault();
      event.stopPropagation();
      if (!isTauri()) return;
      void getCurrentWindow().close().catch((cause) => console.error(cause));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  /** A card was clicked: the band belongs in the main window, not here. */
  const onOpenStrip = useCallback((strip: FocusableStrip) => {
    void emitToMain(NotesEvent.OpenStrip, { strip });
  }, []);

  const onPendingEditHandled = useCallback(() => {
    void emitToMain(NotesEvent.PendingEditHandled, null);
  }, []);

  const onRevealHandled = useCallback(() => {
    void emitToMain(NotesEvent.RevealHandled, null);
  }, []);

  const onDock = useCallback(() => {
    if (!isTauri()) return;
    void getCurrentWindow().close().catch((cause) => console.error(cause));
  }, []);

  const openDocument = context?.document ?? null;

  return (
    <div className="app notes-window">
      <div className="titlebar notes-window-titlebar">
        <div className="titlebar-drag" data-tauri-drag-region="deep">
          <span className="titlebar-title">{openDocument?.documentName ?? "Notes of this PDF"}</span>
        </div>
      </div>

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
          onStatus={setToast}
          pendingEditId={context.pendingEditId}
          onPendingEditHandled={onPendingEditHandled}
          revealId={context.revealId}
          onRevealHandled={onRevealHandled}
          onDock={onDock}
        />
      )}

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
