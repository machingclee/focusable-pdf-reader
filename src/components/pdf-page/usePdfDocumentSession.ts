/**
 * The open document: reading it, opening another, and letting it go.
 *
 * This is the one part of the viewer that cannot be a reducer. A document is a
 * parsed pdf.js object graph with workers, page proxies and canvases behind it —
 * nothing a slice could hold or copy — and every open begins with bytes read from
 * disk, through the library, or from a browser `File`. So the session keeps the
 * document itself, and tells the store the parts the chrome shows
 * (`documentSlice`: path, name, page count, busy, the error line, recents).
 *
 * Three rules are the reason it is a hook of its own rather than a handful of
 * callbacks in the window:
 *
 * - **One open at a time.** `openSeq` numbers the opens, and a slower one that
 *   finishes after a newer one started drops its result instead of painting over
 *   the newer document.
 * - **A page is restored, not jumped.** An open records the page the document was
 *   last read at (`pendingPage`) and the zoom it must settle at first
 *   (`skipRestoreUntilZoom`); `usePlaceRestore` answers the request once the pages
 *   exist. Nothing here scrolls.
 * - **The library is the owner of the file.** A path goes through
 *   `importDocument`, which copies it into the app's library and answers with the
 *   row that owns the copy; only when the backend cannot answer is the file read
 *   directly, and then the notes are out of reach and the reader is told so.
 */
import { useCallback, useRef, useState, type RefObject } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { apiErrorMessage } from "../../store/api/baseApi";
import { pdfDocumentApi } from "../../store/api/pdfDocumentApi";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  busyChanged,
  documentClosed,
  documentOpened,
  errorReported,
  recentOpened,
  recentsRestored,
  selectRecents,
} from "../../store/slices/documentSlice";
import {
  focusModeChanged,
  highlightModeSet,
  pageShown,
} from "../../store/slices/viewerSlice";
import { toastShown } from "../../store/slices/panelsSlice";
import { clamp } from "../../clamp";
import { fitZoom, spreadStart, type PageLayout } from "../../pageLayout";
import {
  fileNameFromPath,
  loadPdfFromBytes,
  type LoadedPdf,
} from "../../pdf";
import { dropRecent, filePathFromFile } from "../../prefs";
import { isPdfFile } from "../../pdfDrop";
import { isTauri } from "../../windowBridge";
import { MAX_ZOOM, MIN_ZOOM } from "../../viewerLimits";
import type { PdfDocumentWithNotes } from "../../types/dto";

export type PdfDocumentSessionOptions = {
  /** The page layout in force, read when an open decides its first page. */
  layoutRef: RefObject<PageLayout>;
  /** The zoom, written when an open fits the page to the window. */
  zoomRef: RefObject<number>;
  /** The page area, whose width a fit measures against. */
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** The hidden file input a browser build clicks instead of a native dialog. */
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** The find bar's hits belong to the document that was open. */
  clearSearch: () => void;
  /** The document is on screen: whatever was about the last one goes. */
  onOpened: (loaded: LoadedPdf) => void;
  /** The document is gone, or is being replaced. */
  onClosed: () => void;
  /** A fit-width zoom, applied through the viewer's own zoom. */
  setZoom: (zoom: number) => void;
};

export type PdfDocumentSession = {
  /** The parsed document, or null. */
  pdf: LoadedPdf | null;
  /** The same value, for the handlers that are installed once. */
  documentRef: RefObject<LoadedPdf | null>;
  /** The file the document came from, as the reader recognises it. */
  openedFile: RefObject<{ name: string; path?: string } | null>;
  /** The page and strip an open asked for, answered by `usePlaceRestore`. */
  pendingPage: RefObject<number | null>;
  pendingStrip: RefObject<{ fracY: number } | null>;
  skipRestoreUntilZoom: RefObject<boolean>;
  /** Bumped when an open has settled at its zoom, to re-run the restore. */
  restoreTick: number;
  /** Ask the restore to look again — a strip was parked on a page not yet laid out. */
  bumpRestore: () => void;
  openWithPicker: () => Promise<void>;
  openViaLibrary: (path: string | string[], name?: string) => Promise<boolean>;
  openFromPath: (path: string, name?: string, stillCurrent?: () => boolean) => Promise<void>;
  loadFromBytes: (
    bytes: Uint8Array,
    sourceName: string,
    options?: { fitWidth?: boolean; path?: string; stillCurrent?: () => boolean },
  ) => Promise<void>;
  /** A browser `File` was dropped or picked. */
  openFiles: (files: File[]) => Promise<void>;
  closePdf: () => void;
};

export function usePdfDocumentSession({
  layoutRef,
  zoomRef,
  scrollerRef,
  fileInputRef,
  clearSearch,
  onOpened,
  onClosed,
  setZoom,
}: PdfDocumentSessionOptions): PdfDocumentSession {
  const dispatch = useAppDispatch();
  const recents = useAppSelector(selectRecents);
  const recentsRef = useRef(recents);
  recentsRef.current = recents;

  const [pdf, setDocument] = useState<LoadedPdf | null>(null);
  const documentRef = useRef<LoadedPdf | null>(null);
  const openedFile = useRef<{ name: string; path?: string } | null>(null);
  /** Bumped on every open, so a slower import cannot paint over a newer one. */
  const openSeq = useRef(0);
  const pendingPage = useRef<number | null>(null);
  const pendingStrip = useRef<{ fracY: number } | null>(null);
  const skipRestoreUntilZoom = useRef(false);
  const [restoreTick, setRestoreTick] = useState(0);

  const [importDocument] = pdfDocumentApi.endpoints.importDocument.useMutation();

  const setBusy = (value: boolean) => dispatch(busyChanged(value));
  const setError = (message: string | null) => dispatch(errorReported(message));
  const setSavedToast = (message: string) => dispatch(toastShown(message));
  /** Fold a document into the recents list, at the page it opens at. */
  const rememberOpen = useCallback(
    (name: string, path: string | undefined, page: number) => {
      dispatch(recentOpened({ name, path, page }));
    },
    [dispatch],
  );
  /** A file is gone: its entry leaves the list. */
  const forgetRecent = useCallback(
    (path: string) => {
      dispatch(recentsRestored(dropRecent(recentsRef.current, path)));
    },
    [dispatch],
  );

  const closePdf = useCallback(() => {
    void documentRef.current?.document.cleanup();
    documentRef.current = null;
    openedFile.current = null;
    pendingPage.current = null;
    pendingStrip.current = null;
    setDocument(null);
    // The path is what the notes column, the badges and the detached window
    // display. Clearing the pages and leaving the path would keep the old
    // document on screen.
    dispatch(documentClosed());
    dispatch(pageShown(1));
    dispatch(focusModeChanged(false));
    dispatch(highlightModeSet(false));
    clearSearch();
    // The band, its menu, the menus and the annotation pieces belong to the
    // viewer's stage, which is what `onClosed` puts away.
    onClosed();
  }, [clearSearch, dispatch, onClosed]);

  const loadFromBytes = useCallback(
    async (
      bytes: Uint8Array,
      sourceName: string,
      options: { fitWidth?: boolean; path?: string; stillCurrent?: () => boolean } = {},
    ) => {
      const fitWidth = options.fitWidth ?? true;
      setBusy(true);
      setError(null);
      try {
        const loaded = await loadPdfFromBytes(bytes, sourceName);
        // A newer open cleared the screen while this one was parsing. Drop the
        // result instead of putting the old file back.
        if (options.stillCurrent && !options.stillCurrent()) {
          void loaded.document.cleanup();
          return;
        }
        const prior = recentsRef.current.find((doc) =>
          options.path ? doc.path === options.path : !doc.path && doc.name === sourceName,
        );
        const targetPage = clamp(Math.round(prior?.page ?? 1), 1, loaded.pages.length);
        void documentRef.current?.document.cleanup();
        documentRef.current = loaded;
        openedFile.current = { name: sourceName, path: options.path };
        dispatch(
          documentOpened({
            path: options.path ?? null,
            name: sourceName,
            pageCount: loaded.pages.length,
          }),
        );
        pendingPage.current = targetPage;
        pendingStrip.current = null;
        skipRestoreUntilZoom.current = fitWidth;
        setDocument(loaded);
        dispatch(pageShown(spreadStart(targetPage, layoutRef.current)));
        clearSearch();
        dispatch(focusModeChanged(false));
        rememberOpen(sourceName, options.path, targetPage);
        // A band parked on the old document's strip means nothing here, and a
        // page menu belongs to the page it was opened on.
        onOpened(loaded);

        requestAnimationFrame(() => {
          const scroller = scrollerRef.current;
          const first = loaded.pages[0];
          if (fitWidth && scroller && first) {
            const widths = loaded.pages.slice(0, 2).map((page) => page.width);
            const next = clamp(fitZoom(scroller.clientWidth, widths, layoutRef.current), MIN_ZOOM, MAX_ZOOM);
            zoomRef.current = next;
            setZoom(next);
          }
          skipRestoreUntilZoom.current = false;
          setRestoreTick((tick) => tick + 1);
        });
      } catch (cause) {
        console.error(cause);
        setError(cause instanceof Error ? cause.message : "Could not open that PDF.");
      } finally {
        // A newer open owns the busy flag. Clearing it here would hide that
        // open's wait.
        if (!options.stillCurrent || options.stillCurrent()) setBusy(false);
      }
    },
    [clearSearch, dispatch, layoutRef, onOpened, zoomRef, setZoom],
  );

  const openFromPath = useCallback(
    async (path: string, name = fileNameFromPath(path), stillCurrent?: () => boolean) => {
      try {
        const bytes = await readFile(path);
        if (stillCurrent && !stillCurrent()) return;
        await loadFromBytes(bytes, name, { path, stillCurrent });
      } catch (cause) {
        if (stillCurrent && !stillCurrent()) return;
        console.error(cause);
        setBusy(false);
        forgetRecent(path);
        setError("That file is no longer available.");
      }
    },
    [forgetRecent, loadFromBytes],
  );

  /**
   * Open one or more PDFs by path through the library.
   *
   * The backend copies each file once — under `<app data>/library/<sha256>.pdf`
   * — and answers with the document that now owns each copy. The first copy's
   * path is what the viewer reads. Every note is stored against its own copy, so
   * moving or renaming a file the reader picked cannot break that document later.
   *
   * Returns whether a document ended up on screen, which is what callers that
   * have something to do afterwards (the Dashboard tab parking a strip) need to know:
   * a legacy document's path changes during the open, so the caller cannot
   * compare paths itself.
   *
   * The previous document is taken off the screen before the request. The pages,
   * the notes column and the badges all read local state, so leaving them up
   * would keep showing the old file while the library answers.
   */
  const openViaLibrary = useCallback(
    async (sourcePath: string | string[], name?: string): Promise<boolean> => {
      const sourcePaths = (Array.isArray(sourcePath) ? sourcePath : [sourcePath]).filter(
        (path) => path.length > 0,
      );
      if (sourcePaths.length === 0) return false;
      // A display name only belongs to a single open. A batch takes each file's name.
      const singleName = sourcePaths.length === 1 ? name : undefined;
      const seq = ++openSeq.current;
      const stillCurrent = () => openSeq.current === seq;
      closePdf();
      setBusy(true);
      setError(null);

      let documents: PdfDocumentWithNotes[];
      try {
        documents = await importDocument({ source_paths: sourcePaths, name: singleName }).unwrap();
      } catch (cause) {
        if (!stillCurrent()) return false;
        const status = (cause as { status?: unknown }).status;
        if (status === 404 || status === 400) {
          // The file is gone or is not a PDF: the same answer the reader got
          // before imports existed, and the entry that led here is stale.
          if (sourcePaths.length === 1) forgetRecent(sourcePaths[0]!);
          setBusy(false);
          setError(
            status === 404
              ? "That file is no longer available."
              : sourcePaths.length === 1
                ? "That file is not a PDF."
                : (apiErrorMessage(cause) ?? "One of those files is not a PDF."),
          );
          return false;
        }
        // The backend is down or failing. Reading the file directly still shows
        // the pages; only the notes are out of reach, and the toast says so.
        console.error(cause);
        setSavedToast("Notes are unavailable right now; opened the file directly.");
        await openFromPath(sourcePaths[0]!, singleName, stillCurrent);
        return stillCurrent() && openedFile.current?.path === sourcePaths[0];
      }

      if (!stillCurrent()) return false;

      // Opening by the original path is a one-off: from now on the document is
      // the copy, which is already in Recents under its own path.
      for (const path of sourcePaths) {
        if (!documents.some((document) => document.file_path === path)) {
          forgetRecent(path);
        }
      }
      const document = documents[0];
      if (!document) {
        setBusy(false);
        return false;
      }
      await openFromPath(document.file_path, document.name, stillCurrent);
      return stillCurrent() && openedFile.current?.path === document.file_path;
    },
    [closePdf, forgetRecent, importDocument, openFromPath],
  );

  const openWithPicker = useCallback(async () => {
    try {
      if (isTauri()) {
        const selected = await open({
          multiple: true,
          title: "Open PDFs",
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (selected === null) return;
        const paths = (Array.isArray(selected) ? selected : [selected]).filter((path) => path.length > 0);
        if (paths.length === 0) return;
        await openViaLibrary(paths);
        return;
      }
      fileInputRef.current?.click();
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : "File dialog failed.");
    }
  }, [openViaLibrary]);

  const onHtmlFiles = useCallback(
    async (files: File[]) => {
      const pdfs = files.filter(isPdfFile);
      if (pdfs.length === 0) return;
      // A desktop file input carries a real path on each file. Those go through
      // the library together, the same way the Open dialog does.
      const paths = pdfs.flatMap((file) => {
        const path = filePathFromFile(file);
        return path ? [path] : [];
      });
      if (paths.length === pdfs.length) {
        await openViaLibrary(paths);
        return;
      }
      // A plain browser file has no path the library can copy, so the viewer
      // shows the first PDF of the selection.
      const file = pdfs[0]!;
      const buffer = await file.arrayBuffer();
      await loadFromBytes(new Uint8Array(buffer), file.name, { path: filePathFromFile(file) });
    },
    [loadFromBytes, openViaLibrary],
  );
  return {
    pdf,
    documentRef,
    openedFile,
    pendingPage,
    pendingStrip,
    skipRestoreUntilZoom,
    restoreTick,
    bumpRestore: () => setRestoreTick((tick) => tick + 1),
    openWithPicker,
    openViaLibrary,
    openFromPath,
    loadFromBytes,
    openFiles: onHtmlFiles,
    closePdf,
  };
}
