/**
 * The popped-out notes window's side of the bridge.
 *
 * The main window stays the source of truth for everything that column needs to
 * know: which PDF is open, which strip a badge asked to see, and which card should
 * take the caret. It is sent as a snapshot; the data itself is fetched by each
 * window from the backend. Everything here is one direction or the other of that
 * conversation, which is why it is one hook rather than seven loose effects:
 *
 * - **out** — the snapshot, whenever it changes and again when the window says it
 *   has just mounted (it missed the last one);
 * - **in** — a card clicked in the other window asks this one to stand the band on
 *   its strip; the column confirms it has placed a card, and that confirmation is
 *   what clears the "show this one" request;
 * - **in, app-wide** — another window wrote something. It does not say what, and
 *   it does not have to: every tag type goes stale and RTK Query refetches what
 *   this window is showing. A window's own announcement is skipped, because the
 *   mutation's effects are already here.
 *
 * It also adopts a notes window that outlived a reload of this one — in dev every
 * edit reloads the webview — so closing that window still docks the panel.
 */
import { useEffect, useRef } from "react";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { AnnotationWithDocument, Note, NoteWithDocument } from "../../types/dto";
import { invalidateEveryTag } from "../../store/cacheStale";
import { useAppDispatch } from "../../store/hooks";
import {
  NotesEvent,
  currentLabel,
  emitToNotes,
  getNotesWindow,
  isTauri,
  subscribe,
  type CacheStalePayload,
  type NotesContext,
  type OpenStripRequest,
} from "../../windowBridge";

export type NotesWindowBridgeOptions = {
  /** The column lives in its own window. */
  detached: boolean;
  /** What the other window needs to know about this one, as it stands now. */
  context: NotesContext;
  /** Stand the band on this strip — press happened in the other window. */
  parkStrip: (strip: Note) => void;
  /** The other window has placed the card it was asked for. */
  clearReveal: () => void;
  /** The other window has put the caret in the card a save asked for. */
  clearPendingEdit: () => void;
  /**
   * The popped-out column clicked a reference to a note in another document: that
   * is an open, and opening belongs to this window.
   */
  revealNote: (strip: NoteWithDocument) => void;
  /** The same, for a reference to a pin. */
  revealAnnotation: (annotation: AnnotationWithDocument) => void;
  /** Adopt a window found on startup, watching for its close. */
  adopt: (win: WebviewWindow) => Promise<() => void>;
  /** The adopted window has gone: dock the column back. */
  onDetachedChange: (detached: boolean) => void;
};

export function useNotesWindowBridge({
  detached,
  context,
  parkStrip,
  clearReveal,
  clearPendingEdit,
  revealNote,
  revealAnnotation,
  adopt,
  onDetachedChange,
}: NotesWindowBridgeOptions): void {
  const dispatch = useAppDispatch();

  /** The handlers below outlive any one render, so they read the newest values. */
  const latestContext = useRef(context);
  latestContext.current = context;
  const latestParkStrip = useRef(parkStrip);
  latestParkStrip.current = parkStrip;
  const latestRevealNote = useRef(revealNote);
  latestRevealNote.current = revealNote;
  const latestRevealAnnotation = useRef(revealAnnotation);
  latestRevealAnnotation.current = revealAnnotation;

  useEffect(() => {
    if (!detached) return;
    void emitToNotes(NotesEvent.Context, context);
  }, [context, detached]);

  useEffect(
    () =>
      subscribe(NotesEvent.Ready, () => {
        // The window mounted after the last snapshot was sent, so it is asking
        // for the current one. The ref keeps this handler independent of the
        // context, which changes on every badge click.
        const latest = latestContext.current;
        if (latest) void emitToNotes(NotesEvent.Context, latest);
      }),
    [],
  );

  useEffect(
    () =>
      subscribe<OpenStripRequest>(NotesEvent.OpenStrip, ({ strip }) => {
        latestParkStrip.current(strip);
        // The band follows the card, but this window does not come forward with
        // it: the press happened in the popped-out column, and raising this one
        // would take the caret out of the note the reader just clicked. They see
        // the band move behind the other window, and keep typing/clicking where
        // they are.
      }),
    [],
  );

  /**
   * A reference clicked in the other column: an open, so it lands on the same
   * functions this window's docked column calls.
   */
  useEffect(
    () =>
      subscribe<{ strip: NoteWithDocument }>(NotesEvent.ShowNote, ({ strip }) => {
        void latestRevealNote.current(strip);
      }),
    [],
  );

  useEffect(
    () =>
      subscribe<{ annotation: AnnotationWithDocument }>(NotesEvent.ShowAnnotation, ({ annotation }) => {
        void latestRevealAnnotation.current(annotation);
      }),
    [],
  );

  useEffect(() => subscribe(NotesEvent.RevealHandled, clearReveal), [clearReveal]);

  useEffect(() => subscribe(NotesEvent.PendingEditHandled, clearPendingEdit), [clearPendingEdit]);

  useEffect(
    () =>
      subscribe<CacheStalePayload>(NotesEvent.CacheStale, (payload) => {
        // Another window wrote something. Its own announcement is skipped — the
        // mutation's effects are already here.
        if (payload.source === currentLabel()) return;
        invalidateEveryTag(dispatch);
      }),
    [dispatch],
  );

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getNotesWindow()
      .then(async (win) => {
        if (!win || cancelled) return;
        onDetachedChange(true);
        const off = await adopt(win);
        if (cancelled) off();
        else unlisten = off;
      })
      .catch((cause) => console.error(cause));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [adopt, onDetachedChange]);
}
