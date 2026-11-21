import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";
import "./App.css";
import { BackendStatusChip } from "./components/BackendStatusBar";
import { TitleBar, type AppTab } from "./components/TitleBar";
import { NotesView } from "./components/NotesView";
import { DocumentNotesPanel } from "./components/DocumentNotesPanel";
import { ListTree, Minus, Plus, StickyNote } from "lucide-react";
import {
  DEFAULT_NOTES_PANEL,
  MIN_NOTES_PANEL,
  maxNotesPanelWidth,
  PATHLESS_NOTES_MESSAGE,
  resolveNotesPanelDrag,
  restoredNotesPanelWidth,
} from "./notesPanel";
import {
  fileNameFromPath,
  loadPdfFromBytes,
  renderPageToCanvas,
  renderPageTextLayer,
  type LoadedPage,
  type LoadedPdf,
} from "./pdf";
import { findParagraphAt, paragraphBoxesFromTextLayer } from "./paragraph";
import { placeStripPoint, STRIP_LINE_FRACTION } from "./stripLine";
import { stripSelectBand } from "./stripSelect";
import { panelShortcut } from "./shortcuts";
import { zoomForArea } from "./zoomProportion";
import { zoomAnchorInArea } from "./zoomAnchor";
import { endDragOnBlur } from "./windowDrag";
import {
  closedByEscape,
  escapeKeptByEditor,
  type EscapeLayer,
} from "./escapeDismiss";
import { findHits, type SearchBox, type SearchHit } from "./search";
import {
  dropRecent,
  filePathFromFile,
  loadPrefs,
  rememberPage,
  rememberRecent,
  savePrefs,
  type RecentDoc,
} from "./prefs";
import { installAppMenu, setDocumentMenuName } from "./appMenu";
import type { FocusableStrip, PdfDocumentListItem, PdfDocumentWithStrips } from "./types/dto";
import { apiErrorMessage } from "./store/api/baseApi";
import { focusableStripApi } from "./store/api/focusableStripApi";
import { pdfDocumentApi } from "./store/api/pdfDocumentApi";
import { appStateApi } from "./store/api/appStateApi";
import { applyRemoteInvalidation } from "./store/crossWindowSync";
import { useAppDispatch } from "./store/hooks";
import { loadNotesWindowRect } from "./notesWindowGeometry";
import {
  NotesEvent,
  emitToNotes,
  getNotesWindow,
  isTauri,
  openNotesWindow,
  subscribe,
  type InvalidatePayload,
  type NotesContext,
} from "./windowBridge";
import { savedStripGeometry } from "./stripAnchor";
import { noteSummary } from "./notesText";
import { REMARK_MARKER_SIZE, remarkMarkerLeft, remarkedStrips } from "./stripRemark";

const APP_TITLE = "PDF Focus Viewer";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 6;
const MIN_STRIP = 10;
const MAX_STRIP = 640;
const DEFAULT_STRIP = 160;
const MIN_BLUR = 0;
const MAX_BLUR = 25;
const DEFAULT_BLUR = 5;
/** `app_state` key; dotted so the table can hold other panels later. */
const NOTES_PANEL_WIDTH_KEY = "notes_panel.width";

const MIN_RAIL = 132;
const MAX_RAIL = 360;
const DEFAULT_RAIL = 176;
// Rail chrome around a thumbnail: 12px pane padding each side plus the 6px
// padding the .thumb highlight needs, leaving a little slack.
const RAIL_CHROME = 40;
const STRIP_STEP = 12;
/**
 * How long a note badge's click waits before it opens the notes column.
 *
 * One control, two actions: a click shows the note, a double-click puts the
 * strip on the page. A double-click arrives as two clicks followed by a
 * `dblclick`, so the first click cannot act immediately — it waits this long, and
 * the second press drops it. Short enough to feel like a click, long enough for
 * the system's own double-click interval to fit in it.
 */
const REMARK_CLICK_DELAY_MS = 240;

/** On-screen CSS px for a strip measured in PDF points (1pt = 1px at 100% zoom). */
function stripScreenPx(pt: number, zoom: number): number {
  return pt * zoom;
}
const initialPrefs = loadPrefs();
const NO_HITS: Array<{ index: number; boxes: SearchBox[] }> = [];
const SEARCH_DEBOUNCE_MS = 250;
/** Multiplier for one `+` / `-` step. Small on purpose: a fine step reads as a
    smooth zoom, a coarse one as a jump. 1.1 was the old value. */
const ZOOM_STEP = 1.025;

type WebKitGestureEvent = Event & {
  scale: number;
  clientX: number;
  clientY: number;
};

type ZoomAnchor = {
  clientX: number;
  clientY: number;
  page: number;
  fracX: number;
  fracY: number;
};

type DragLock = {
  holeTop: number;
  holeHeight: number;
};

/** Strip center locked to a page so it rides scroll / zoom. */
type ContentLock = {
  page: number;
  fracY: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pageElementAtPoint(
  scroller: HTMLElement | null,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  if (!scroller) return null;
  const pages = scroller.querySelectorAll<HTMLElement>("[data-page]");
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const node of pages) {
    const rect = node.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      return node;
    }
    const nearestX = clamp(clientX, rect.left, rect.right);
    const nearestY = clamp(clientY, rect.top, rect.bottom);
    const dist = Math.hypot(clientX - nearestX, clientY - nearestY);
    if (dist < bestDist) {
      best = node;
      bestDist = dist;
    }
  }
  return best;
}

function contentLockAtPoint(
  scroller: HTMLElement | null,
  clientX: number,
  clientY: number,
): ContentLock | null {
  const page = pageElementAtPoint(scroller, clientX, clientY);
  if (!page) return null;
  const rect = page.getBoundingClientRect();
  return {
    page: Number(page.dataset.page) || 1,
    fracY: rect.height ? (clientY - rect.top) / rect.height : 0.5,
  };
}

function stageYFromContentLock(
  stage: HTMLElement,
  scroller: HTMLElement | null,
  lock: ContentLock,
): number | null {
  const page = scroller?.querySelector<HTMLElement>(`[data-page="${lock.page}"]`);
  if (!page) return null;
  const stageRect = stage.getBoundingClientRect();
  const pageRect = page.getBoundingClientRect();
  return pageRect.top - stageRect.top + lock.fracY * pageRect.height;
}

function isPdfFile(file: File): boolean {
  if (file.type === "application/pdf") return true;
  return file.name.toLowerCase().endsWith(".pdf");
}

function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}

/**
 * Whether a path is one of the app's own library copies.
 *
 * Every imported document lives in `<app data>/library/<sha256>.pdf`, and that
 * path is never what the reader recognises a book by — the original path is, and
 * that is what the backend stores as `original_path`.
 */
function isLibraryPath(path: string): boolean {
  return /[/\\]library[/\\]/.test(path);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}

/**
 * The band menu's one action, named for the write it will do.
 *
 * A band parked on a saved strip is that row, so its action updates the row; a
 * band parked on a passage has no row yet, so its action creates one. Two names
 * for two writes, so the label never promises the wrong one.
 */
function stripMenuCopy(updating: boolean): { action: string; busy: string; hint: string } {
  return updating
    ? {
        action: "Update note",
        busy: "Updating...",
        hint: "Writes this position and size back to the strip it came from.",
      }
    : {
        action: "Save note",
        busy: "Saving...",
        hint: "Adds this strip to the open document, with an optional note.",
      };
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);

  return debounced;
}

const SearchBar = memo(function SearchBar({
  committedQuery,
  onCommit,
  onStep,
  onClose,
  inputRef,
  activeHit,
  hitCount,
}: {
  committedQuery: string;
  onCommit: (query: string) => void;
  onStep: (delta: number) => void;
  onClose: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  activeHit: number;
  hitCount: number;
}) {
  const [draft, setDraft] = useState(committedQuery);
  const draftRef = useRef(draft);
  const committedRef = useRef(committedQuery);
  draftRef.current = draft;
  committedRef.current = committedQuery;

  useEffect(() => {
    setDraft(committedQuery);
  }, [committedQuery]);

  useEffect(() => {
    if (draft === committedQuery) return;
    const id = window.setTimeout(() => onCommit(draft), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [committedQuery, draft, onCommit]);

  return (
    <form
      className="search-bar"
      onSubmit={(event) => {
        event.preventDefault();
        const query = draftRef.current;
        if (query !== committedRef.current) {
          onCommit(query);
          return;
        }
        onStep(1);
      }}
    >
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (!next.trim()) onCommit("");
        }}
        placeholder="Find in document"
        autoComplete="off"
        spellCheck={false}
        autoFocus
      />
      <span className="search-count">
        {committedQuery.trim()
          ? hitCount
            ? `${activeHit + 1} / ${hitCount}`
            : "0 / 0"
          : ""}
      </span>
      <button type="button" className="icon" onClick={() => onStep(-1)} disabled={hitCount === 0} aria-label="Previous match">
        ↑
      </button>
      <button type="submit" className="icon" disabled={hitCount === 0 && !draft.trim()} aria-label="Next match">
        ↓
      </button>
      <button type="button" className="icon" onClick={onClose} aria-label="Close search">
        ×
      </button>
    </form>
  );
});

const PdfPageView = memo(function PdfPageView({
  page,
  renderZoom,
  hits,
  activeHit,
}: {
  page: LoadedPage;
  renderZoom: number;
  hits: Array<{ index: number; boxes: SearchBox[] }>;
  activeHit: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setShouldRender(true);
      },
      { rootMargin: "1400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldRender) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const task = renderPageToCanvas(page.pdfPage, canvas, renderZoom);
    return () => task.cancel();
  }, [page, renderZoom, shouldRender]);

  useEffect(() => {
    if (!shouldRender) return;
    const container = textLayerRef.current;
    if (!container) return;
    const task = renderPageTextLayer(page.pdfPage, container, page.textContent);
    return () => task.cancel();
  }, [page, shouldRender]);

  return (
    <div
      ref={wrapRef}
      className="page-shell"
      data-page={page.index}
      style={{
        /* Sizes live in CSS as `calc(var(--page-w) * var(--zoom))`, so a zoom
           tick only rewrites one custom property on the column instead of
           re-rendering every page in the document. */
        ["--page-w" as string]: String(page.width),
        ["--page-h" as string]: String(page.height),
      }}
    >
      <canvas ref={canvasRef} />
      <div ref={textLayerRef} className="textLayer" />
      {hits.length > 0 && (
        <div className="search-layer" aria-hidden>
          {hits.map((hit) =>
            hit.boxes.map((box, boxIndex) => (
              <div
                key={`${hit.index}-${boxIndex}`}
                data-hit={hit.index}
                className={hit.index === activeHit ? "search-hit current" : "search-hit"}
                style={{
                  ["--hit-x" as string]: String(box.left),
                  ["--hit-y" as string]: String(box.top),
                  ["--hit-w" as string]: String(box.width),
                  ["--hit-h" as string]: String(box.height),
                }}
              />
            )),
          )}
        </div>
      )}
      <span className="page-index">{page.index}</span>
    </div>
  );
});

const ThumbnailView = memo(function ThumbnailView({
  page,
  active,
  width,
  onSelect,
}: {
  page: LoadedPage;
  active: boolean;
  width: number;
  onSelect: (index: number) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shouldRender, setShouldRender] = useState(false);
  const scale = width / page.width;
  const cssHeight = page.height * scale;

  useEffect(() => {
    const node = buttonRef.current;
    if (!node) return;
    const root = node.closest(".thumbs");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setShouldRender(true);
      },
      { root: root instanceof Element ? root : null, rootMargin: "480px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldRender) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const task = renderPageToCanvas(page.pdfPage, canvas, scale);
    return () => task.cancel();
  }, [page, scale, shouldRender]);

  useEffect(() => {
    if (!active) return;
    buttonRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={active ? "thumb active" : "thumb"}
      onClick={() => onSelect(page.index)}
      aria-current={active ? "page" : undefined}
      aria-label={`Go to page ${page.index}`}
    >
      <span className="thumb-shell" style={{ width, height: cssHeight }}>
        <canvas ref={canvasRef} />
      </span>
      <span className="thumb-label">{page.index}</span>
    </button>
  );
});

function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);
  const focusOverlayRef = useRef<HTMLDivElement>(null);
  /** The area a `⌘`-drag is choosing, drawn over the veil; see `startStripSelect`. */
  const stripSelectRef = useRef<HTMLDivElement>(null);
  const parkedCenterYRef = useRef<number | null>(null);
  const contentLockRef = useRef<ContentLock | null>(null);
  const dragLockRef = useRef<DragLock | null>(null);
  const pdfRef = useRef<LoadedPdf | null>(null);
  const zoomRef = useRef(1);
  const stripHeightRef = useRef(DEFAULT_STRIP);
  const stripBlurRef = useRef(DEFAULT_BLUR);
  const gestureStartZoom = useRef(1);
  const gestureActive = useRef(false);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const jumpingToPage = useRef<number | null>(null);
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const railPaneRef = useRef<HTMLElement>(null);
  const restoredLast = useRef(false);
  const recentsRef = useRef(initialPrefs.recents);
  const currentPageRef = useRef(1);
  const openDocRef = useRef<{ name: string; path?: string } | null>(null);
  /** Focus mode as the overlay's layout sees it; that runs outside React's render. */
  const focusModeRef = useRef(false);
  /** The strips wearing a note badge, in draw order; see `layoutRemarkMarkers`. */
  const remarkedStripsRef = useRef<FocusableStrip[]>([]);
  /** The badge element per strip id, so the layout pass can place it. */
  const remarkNodes = useRef(new Map<number, HTMLButtonElement>());
  /**
   * The badge click that is waiting out `REMARK_CLICK_DELAY_MS`, if any. One
   * badge at a time can have a press in flight, so one timer is enough.
   */
  const remarkClickTimer = useRef<number | null>(null);
  const pendingPageRestore = useRef<number | null>(null);
  /** Page point a just-opened saved strip wants on the band line, if any. */
  const pendingStripRestore = useRef<{ fracY: number } | null>(null);
  const skipRestoreUntilZoom = useRef(false);
  const openSearchRef = useRef<() => void>(() => { });
  const stepHitRef = useRef<(delta: number) => void>(() => { });
  const openWithPickerRef = useRef<() => void>(() => { });
  const nudgeFocusStripRef = useRef<(deltaY: number) => void>(() => { });

  /** Needed to hand the other window's invalidations to this window's cache. */
  const dispatch = useAppDispatch();

  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [zoom, setZoom] = useState(1);
  const [focusMode, setFocusMode] = useState(false);
  const [showThumbs, setShowThumbs] = useState(true);
  const [railWidth, setRailWidth] = useState(DEFAULT_RAIL);
  const [currentPage, setCurrentPage] = useState(1);
  const [stripHeight, setStripHeightState] = useState(() =>
    clamp(initialPrefs.stripBase, MIN_STRIP, MAX_STRIP),
  );
  const [stripBlur, setStripBlur] = useState(() =>
    clamp(initialPrefs.stripBlur, MIN_BLUR, MAX_BLUR),
  );
  const [recents, setRecents] = useState<RecentDoc[]>(() => initialPrefs.recents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The stage's measured size. The band and the note badges are both laid out in
   * stage coordinates, so a resize — the window, the pages rail, the notes column
   * — has to re-lay them out: the height decides where the band sits, the width
   * where the page's left edge (and so the badges) lands.
   */
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  /** The page area's width at the last measurement, for the ratio a toggle makes. */
  const stageWidthRef = useRef(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeHit, setActiveHit] = useState(-1);
  const [pageDraft, setPageDraft] = useState("1");
  const [restoreTick, setRestoreTick] = useState(0);
  /**
   * Right-click menu on the display strip. `display strip` is the band the
   * overlay draws; `saved strip` is the `focusable_strip` row it becomes.
   */
  const stripMenuRef = useRef<HTMLDivElement | null>(null);
  const [stripMenu, setStripMenu] = useState<{ x: number; y: number } | null>(null);
  const [stripSaveState, setStripSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [stripSaveMessage, setStripSaveMessage] = useState<string | null>(null);
  /**
   * The saved strip the display strip is sitting on, or null when the band is
   * somewhere no row describes.
   *
   * Clicking a card parks the band on that strip's own page point and height, so
   * from then on the band *is* that row: resizing it and opening the menu offers
   * **Update note**, which writes the new geometry back instead of saving a
   * second copy of the same passage. It lasts while the band is moved by the
   * resize borders, `↑` / `↓` or the height keys — all still that strip — and is
   * dropped when the band is parked somewhere else (a double-click on the page,
   * another document).
   */
  const [displayStripId, setDisplayStripId] = useState<number | null>(null);
  /**
   * Confirmation for a strip that was just stored. The context menu is closed
   * by the time the popup confirms, so the success message has nowhere else to
   * live; it clears itself after a few seconds.
   */
  const [savedToast, setSavedToast] = useState<string | null>(null);
  /** Which of the two top-level views is showing. */
  const [view, setView] = useState<AppTab>("pdf");
  /** The open file's path as state, for the components that need to resolve it. */
  const [openPath, setOpenPath] = useState<string | null>(null);
  /** Just-saved strip whose card should open its remark field. */
  const [pendingNoteEditId, setPendingNoteEditId] = useState<number | null>(null);
  /**
   * The docked "Notes of this PDF" panel: the open document's strips, beside the
   * page rather than instead of it. Independent of the top-level `view` tab,
   * because both can be useful at once — read on the left, notes on the right.
   */
  const [notesPanelOpen, setNotesPanelOpen] = useState(false);
  /**
   * The notes column lives in its own window.
   *
   * While true the inline column is not rendered and `notesPanelOpen` stays
   * false, so the toolbar toggle reads as "raise the column" rather than as one
   * that is already on screen. Closing the window docks it back, open.
   */
  const [notesDetached, setNotesDetached] = useState(false);
  const [notesPanelWidth, setNotesPanelWidth] = useState(DEFAULT_NOTES_PANEL);
  const notesPaneRef = useRef<HTMLElement | null>(null);
  /** Last width that was wide enough to keep; restored when the drag closes the column. */
  const lastNotesPanelWidthRef = useRef(DEFAULT_NOTES_PANEL);
  /**
   * The strip a note badge asked the notes column to show. It is an id rather than
   * a "scroll now" command because the card may not exist yet — its folder can be
   * closed, or its rows still loading — so `StripList` is the one that waits for
   * it and then puts it on the list's line.
   */
  const [revealStripId, setRevealStripId] = useState<number | null>(null);

  const [resolveDocument] = pdfDocumentApi.endpoints.getOrCreateDocument.useLazyQuery();
  const [importDocument] = pdfDocumentApi.endpoints.importDocument.useMutation();
  const [createStrip] = focusableStripApi.endpoints.createStrip.useMutation();
  const [updateStrip] = focusableStripApi.endpoints.updateStrip.useMutation();
  const { data: appState } = appStateApi.endpoints.getAppState.useQuery();
  const [putAppState] = appStateApi.endpoints.setAppState.useMutation();
  /**
   * The open document's saved strips, for the note badges.
   *
   * The document is found in the list the Notes tab already reads rather than
   * resolved with the upsert the notes column uses: a badge must not be the reason
   * a PDF gets registered, and a document nobody ever saved has no strips to mark.
   * Both queries are tag-driven like every other one, so a note written, edited or
   * deleted anywhere reaches the badges through the same invalidation that
   * refreshes the cards.
   */
  const { data: savedDocuments } = pdfDocumentApi.endpoints.listDocuments.useQuery(undefined, {
    skip: !openPath,
  });
  const openDocumentId = useMemo(
    () =>
      openPath ? (savedDocuments?.find((document) => document.file_path === openPath)?.id ?? null) : null,
    [openPath, savedDocuments],
  );
  const { data: savedStrips } = focusableStripApi.endpoints.listStrips.useQuery(
    { pdf_document_id: openDocumentId ?? 0 },
    { skip: openDocumentId == null },
  );
  /** One badge per saved strip with a remark, in draw order. */
  const remarked = useMemo(() => remarkedStrips(savedStrips ?? []), [savedStrips]);
  /** The stored width is applied once; later writes must not fight the drag. */
  const notesPanelWidthLoaded = useRef(false);

  /**
   * The notes are on screen — in this window's column or in the popped-out one.
   *
   * Most of the app must not care which: the toolbar button is pressed either
   * way, and a note badge that is already showing its card does not have to wait
   * out the double-click delay. Only the code that *places* the column does.
   */
  const notesOnScreen = notesPanelOpen || notesDetached;

  /** Bring the popped-out window to the front, if there is one. */
  const focusNotesWindow = useCallback(() => {
    void getNotesWindow()
      .then((win) => win?.setFocus())
      .catch((cause) => console.error(cause));
  }, []);

  /**
   * Reveal the notes, wherever they live.
   *
   * Used by everything that used to just open the column: a badge's click, and a
   * strip that was saved and wants its new card's remark field to take the caret.
   * When the column is popped out, raising its window is what makes the typing
   * land in the editor.
   */
  const showNotes = useCallback(() => {
    if (notesDetached) focusNotesWindow();
    else setNotesPanelOpen(true);
  }, [focusNotesWindow, notesDetached]);

  /** The toolbar button and ⌘⌥M: toggle when docked, raise when popped out. */
  const toggleNotesPanel = useCallback(() => {
    if (notesDetached) focusNotesWindow();
    else setNotesPanelOpen((isOpen) => !isOpen);
  }, [focusNotesWindow, notesDetached]);

  /** Switch between the PDF viewer and the Notes browser. */
  const switchView = useCallback((next: AppTab) => {
    setView(next);
  }, []);

  const renderZoom = useDebouncedValue(zoom, 140);
  const thumbWidth = Math.max(72, railWidth - RAIL_CHROME);

  zoomRef.current = zoom;
  stripHeightRef.current = stripHeight;
  stripBlurRef.current = stripBlur;
  recentsRef.current = recents;
  currentPageRef.current = currentPage;
  focusModeRef.current = focusMode;
  remarkedStripsRef.current = remarked;

  useEffect(() => {
    savePrefs({ stripBase: stripHeight, stripBlur, recents });
  }, [stripHeight, stripBlur, recents]);

  // A context menu that outlives its target is worse than no menu: close it on
  // Escape, on a press anywhere outside it, on scroll, and when focus mode ends.
  useEffect(() => {
    if (!stripMenu) return;

    const onPointerDown = (event: PointerEvent) => {
      if (stripMenuRef.current?.contains(event.target as Node)) return;
      setStripMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setStripMenu(null);
    };
    const onScroll = () => setStripMenu(null);

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    const scroller = scrollerRef.current;
    scroller?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      scroller?.removeEventListener("scroll", onScroll);
    };
  }, [stripMenu]);

  useEffect(() => {
    if (!focusMode) setStripMenu(null);
  }, [focusMode]);

  useEffect(() => {
    if (!savedToast) return;
    const timer = window.setTimeout(() => setSavedToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [savedToast]);

  useEffect(() => {
    const sourceName = pdf?.sourceName ?? null;
    const title = sourceName || APP_TITLE;
    document.title = title;
    if (!isTauri()) return;
    void Promise.all([
      getCurrentWindow().setTitle(title),
      setDocumentMenuName(sourceName),
    ]).catch((cause) => {
      console.error(cause);
    });
  }, [pdf]);

  useEffect(() => {
    const open = openDocRef.current;
    if (!pdf || !open) return;
    setRecents((current) => rememberPage(current, open.name, open.path, currentPage));
  }, [currentPage, pdf]);

  useEffect(() => {
    const persistOpenPage = () => {
      const open = openDocRef.current;
      if (!open) return;
      savePrefs({
        stripBase: stripHeightRef.current,
        stripBlur: stripBlurRef.current,
        recents: rememberPage(recentsRef.current, open.name, open.path, currentPageRef.current),
      });
    };
    window.addEventListener("pagehide", persistOpenPage);
    window.addEventListener("beforeunload", persistOpenPage);
    return () => {
      window.removeEventListener("pagehide", persistOpenPage);
      window.removeEventListener("beforeunload", persistOpenPage);
    };
  }, []);

  const captureZoomAnchor = useCallback((clientX: number, clientY: number): ZoomAnchor | null => {
    const scroller = scrollerRef.current;
    if (!scroller) return null;
    const pages = Array.from(scroller.querySelectorAll<HTMLElement>("[data-page]"));
    if (pages.length === 0) return null;

    let best = pages[0];
    let bestDist = Infinity;
    for (const node of pages) {
      const rect = node.getBoundingClientRect();
      const nearestX = clamp(clientX, rect.left, rect.right);
      const nearestY = clamp(clientY, rect.top, rect.bottom);
      const dist = Math.hypot(clientX - nearestX, clientY - nearestY);
      if (dist < bestDist) {
        best = node;
        bestDist = dist;
      }
    }
    const rect = best.getBoundingClientRect();
    return {
      clientX,
      clientY,
      page: Number(best.dataset.page) || 1,
      fracX: rect.width ? (clientX - rect.left) / rect.width : 0.5,
      fracY: rect.height ? (clientY - rect.top) / rect.height : 0.5,
    };
  }, []);

  /* Applied straight away, never tweened: a zoom step has to land under the
     key press that caused it. Smoothness comes from the step being small
     (ZOOM_STEP) plus the page geometry being a CSS variable, not from
     animating towards a target. */
  const applyZoom = useCallback((nextZoom: number, clientX: number, clientY: number) => {
    const current = zoomRef.current;
    const clamped = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(clamped - current) < 0.0001) return;
    zoomAnchorRef.current = captureZoomAnchor(clientX, clientY);
    zoomRef.current = clamped;
    setZoom(clamped);
  }, [captureZoomAnchor]);

  const commitStripCenter = useCallback((clientX: number, clientY: number, stageY: number) => {
    parkedCenterYRef.current = stageY;
    contentLockRef.current = contentLockAtPoint(scrollerRef.current, clientX, clientY);
  }, []);

  const toggleFocusMode = useCallback(() => {
    setFocusMode((on) => {
      if (on) return false;
      const stage = stageRef.current;
      const rect = stage?.getBoundingClientRect();
      const x = cursorRef.current?.x ?? (rect ? rect.left + rect.width / 2 : 0);
      const y = cursorRef.current?.y ?? (rect ? rect.top + rect.height / 2 : 0);
      if (stage && rect) {
        // The strip rides the page, so where it comes back is a content position:
        // the one it was left on, or the pointer's if it has none yet.
        const stageY =
          (contentLockRef.current
            ? stageYFromContentLock(stage, scrollerRef.current, contentLockRef.current)
            : null) ?? parkedCenterYRef.current ?? y - rect.top;
        commitStripCenter(x, rect.top + stageY, stageY);
      }
      return true;
    });
  }, [commitStripCenter]);

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const scroller = scrollerRef.current;
    if (!anchor || !scroller) return;
    zoomAnchorRef.current = null;
    const page = scroller.querySelector<HTMLElement>(`[data-page="${anchor.page}"]`);
    if (!page) return;
    /* The correction, and then what the scroller would not take.
     *
     * A scroll offset is whole pixels in some webviews, so a fractional correction
     * is snapped — and snapped the same way every time, which leaves the anchor a
     * fraction of a pixel low on every toggle. One pixel is invisible; the same
     * pixel on every toggle is what a reader watching the column go in and out
     * sees as the page creeping. So the second step measures again and takes the
     * remainder in whole pixels, which is all a whole-pixel offset can express.
     * Where offsets are fractional the first step already lands and this never
     * moves. */
    const offsetFrom = () => {
      const rect = page.getBoundingClientRect();
      return {
        x: rect.left + rect.width * anchor.fracX - anchor.clientX,
        y: rect.top + rect.height * anchor.fracY - anchor.clientY,
      };
    };
    const exact = offsetFrom();
    scroller.scrollLeft += exact.x;
    scroller.scrollTop += exact.y;
    const left = offsetFrom();
    if (Math.abs(left.x) >= 0.5) scroller.scrollLeft += Math.round(left.x);
    if (Math.abs(left.y) >= 0.5) scroller.scrollTop += Math.round(left.y);
  }, [zoom]);

  const closePdf = useCallback(() => {
    void pdfRef.current?.document.cleanup();
    pdfRef.current = null;
    openDocRef.current = null;
    pendingPageRestore.current = null;
    pendingStripRestore.current = null;
    setPdf(null);
    setCurrentPage(1);
    setHits([]);
    setActiveHit(-1);
    setSearchQuery("");
    setSearchOpen(false);
    setFocusMode(false);
    parkedCenterYRef.current = null;
    contentLockRef.current = null;
    dragLockRef.current = null;
    // The strips of the closed document are not the ones the next one shows.
    setDisplayStripId(null);
  }, []);

  const loadFromBytes = useCallback(
    async (
      bytes: Uint8Array,
      sourceName: string,
      options: { fitWidth?: boolean; path?: string } = {},
    ) => {
      const fitWidth = options.fitWidth ?? true;
      setBusy(true);
      setError(null);
      try {
        const loaded = await loadPdfFromBytes(bytes, sourceName);
        const prior = recentsRef.current.find((doc) =>
          options.path ? doc.path === options.path : !doc.path && doc.name === sourceName,
        );
        const targetPage = clamp(Math.round(prior?.page ?? 1), 1, loaded.pages.length);
        void pdfRef.current?.document.cleanup();
        pdfRef.current = loaded;
        openDocRef.current = { name: sourceName, path: options.path };
        setOpenPath(options.path ?? null);
        pendingPageRestore.current = targetPage;
        pendingStripRestore.current = null;
        skipRestoreUntilZoom.current = fitWidth;
        setPdf(loaded);
        setCurrentPage(targetPage);
        setHits([]);
        setActiveHit(-1);
        setFocusMode(false);
        parkedCenterYRef.current = null;
        contentLockRef.current = null;
        dragLockRef.current = null;
        // A band parked on the old document's strip means nothing here.
        setDisplayStripId(null);
        setRecents((current) => rememberRecent(current, sourceName, options.path, targetPage));

        requestAnimationFrame(() => {
          const scroller = scrollerRef.current;
          const first = loaded.pages[0];
          if (fitWidth && scroller && first) {
            const next = clamp((scroller.clientWidth - 72) / first.width, MIN_ZOOM, MAX_ZOOM);
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
        setBusy(false);
      }
    },
    [],
  );

  const openFromPath = useCallback(
    async (path: string, name = fileNameFromPath(path)) => {
      try {
        const bytes = await readFile(path);
        await loadFromBytes(bytes, name, { path });
      } catch (cause) {
        console.error(cause);
        setRecents((current) => dropRecent(current, path));
        setError("That file is no longer available.");
      }
    },
    [loadFromBytes],
  );

  /**
   * Open a PDF by path through the library.
   *
   * The backend copies the file once — under `<app data>/library/<sha256>.pdf`
   * — and answers with the document that now owns the copy. That copy's path is
   * what the viewer reads and what every note is stored against, so moving or
   * renaming the file the reader picked cannot break the document later.
   *
   * Returns whether a document ended up on screen, which is what callers that
   * have something to do afterwards (the Notes tab parking a strip) need to know:
   * a legacy document's path changes during the open, so the caller cannot
   * compare paths itself.
   */
  const openViaLibrary = useCallback(
    async (sourcePath: string, name?: string): Promise<boolean> => {
      let document: PdfDocumentWithStrips;
      try {
        document = await importDocument({ source_path: sourcePath, name }).unwrap();
      } catch (cause) {
        const status = (cause as { status?: unknown }).status;
        if (status === 404 || status === 400) {
          // The file is gone or is not a PDF: the same answer the reader got
          // before imports existed, and the entry that led here is stale.
          setRecents((current) => dropRecent(current, sourcePath));
          setError(status === 404 ? "That file is no longer available." : "That file is not a PDF.");
          return false;
        }
        // The backend is down or failing. Reading the file directly still shows
        // the pages; only the notes are out of reach, and the toast says so.
        console.error(cause);
        setSavedToast("Notes are unavailable right now; opened the file directly.");
        await openFromPath(sourcePath, name);
        return openDocRef.current?.path === sourcePath;
      }

      // Opening by the original path is a one-off: from now on the document is
      // the copy, which is already in Recents under its own path.
      if (document.file_path !== sourcePath) {
        setRecents((current) => dropRecent(current, sourcePath));
      }
      await openFromPath(document.file_path, document.name);
      return openDocRef.current?.path === document.file_path;
    },
    [importDocument, openFromPath],
  );

  const openWithPicker = useCallback(async () => {
    try {
      if (isTauri()) {
        const selected = await open({
          multiple: false,
          title: "Open PDF",
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (!selected || Array.isArray(selected)) return;
        await openViaLibrary(selected);
        return;
      }
      fileInputRef.current?.click();
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : "File dialog failed.");
    }
  }, [openViaLibrary]);

  const onHtmlFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      const buffer = await file.arrayBuffer();
      await loadFromBytes(new Uint8Array(buffer), file.name, { path: filePathFromFile(file) });
    },
    [loadFromBytes],
  );

  const fitWidth = useCallback(() => {
    const scroller = scrollerRef.current;
    const first = pdfRef.current?.pages[0];
    if (!scroller || !first) return;
    const rect = scroller.getBoundingClientRect();
    applyZoom((scroller.clientWidth - 72) / first.width, rect.left + rect.width / 2, rect.top + 24);
  }, [applyZoom]);

  const bumpZoom = useCallback(
    (factor: number) => {
      const scroller = scrollerRef.current;
      const cursor = cursorRef.current;
      if (!scroller) {
        const next = clamp(zoomRef.current * factor, MIN_ZOOM, MAX_ZOOM);
        zoomRef.current = next;
        setZoom(next);
        return;
      }
      const rect = scroller.getBoundingClientRect();
      applyZoom(
        zoomRef.current * factor,
        cursor?.x ?? rect.left + rect.width / 2,
        cursor?.y ?? rect.top + rect.height / 2,
      );
    },
    [applyZoom],
  );

  const setStripHeight = useCallback((next: number) => {
    setStripHeightState(clamp(next, MIN_STRIP, MAX_STRIP));
  }, []);

  const setBlurRadius = useCallback((next: number) => {
    setStripBlur(clamp(next, MIN_BLUR, MAX_BLUR));
  }, []);

  const scrollScrollerTo = useCallback((node: HTMLElement, block: "start" | "center") => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    let top = nodeRect.top - scrollerRect.top + scroller.scrollTop;
    if (block === "center") {
      top -= Math.max(0, (scrollerRect.height - nodeRect.height) / 2);
    } else {
      top -= 12;
    }
    scroller.scrollTo({ top: Math.max(0, top), left: scroller.scrollLeft });
  }, []);

  const goToPage = useCallback((index: number) => {
    const scroller = scrollerRef.current;
    const node = scroller?.querySelector<HTMLElement>(`[data-page="${index}"]`);
    if (!scroller || !node) return;
    jumpingToPage.current = index;
    setCurrentPage(index);
    scrollScrollerTo(node, "start");
    window.setTimeout(() => {
      if (jumpingToPage.current === index) jumpingToPage.current = null;
    }, 400);
  }, [scrollScrollerTo]);

  const goToHit = useCallback((index: number, list: SearchHit[]) => {
    const hit = list[index];
    if (!hit) return;
    jumpingToPage.current = hit.pageIndex;
    setCurrentPage(hit.pageIndex);
    setActiveHit(index);
  }, []);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setHits([]);
    setActiveHit(-1);
  }, []);

  /**
   * One Escape press: close the outermost overlay the viewer has open.
   *
   * One layer per press — the band's menu, then the search bar, then the notes
   * column, then the reading strip — because the strip is the mode and the others
   * are asides raised over it; `escapeDismiss.ts` holds the order and the
   * reasoning. Returns whether anything was actually closed, so the caller only
   * claims the key when the press did something.
   *
   * The closers are a table rather than a chain of `if`s: the list, not this
   * function, decides what Escape means.
   */
  const closeOverlays = useCallback((): boolean => {
    const closers: Record<EscapeLayer, () => void> = {
      stripMenu: () => setStripMenu(null),
      search: closeSearch,
      notesPanel: () => setNotesPanelOpen(false),
      band: () => setFocusMode(false),
    };
    const closing = closedByEscape({
      stripMenu: stripMenu !== null,
      search: searchOpen,
      notesPanel: notesPanelOpen,
      band: focusMode,
    });
    if (!closing) return false;
    closers[closing]();
    return true;
  }, [closeSearch, focusMode, notesPanelOpen, searchOpen, stripMenu]);

  const stepHit = useCallback((delta: number) => {
    if (hits.length === 0) return;
    const from = activeHit < 0 ? (delta > 0 ? -1 : 0) : activeHit;
    const next = (from + delta + hits.length) % hits.length;
    setActiveHit(next);
    goToHit(next, hits);
  }, [activeHit, goToHit, hits]);

  const commitSearchQuery = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  openSearchRef.current = openSearch;
  stepHitRef.current = stepHit;
  openWithPickerRef.current = () => {
    void openWithPicker();
  };

  useEffect(() => {
    if (!isTauri()) return;
    void installAppMenu({
      onOpen: () => openWithPickerRef.current(),
      onFind: () => openSearchRef.current(),
      onFindNext: () => stepHitRef.current(1),
      onFindPrev: () => stepHitRef.current(-1),
    }).catch((cause) => {
      console.error(cause);
    });
  }, []);

  const onRailResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pane = railPaneRef.current;
    if (!pane) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    const startX = event.clientX;
    const startWidth = pane.getBoundingClientRect().width;

    const onMove = (move: PointerEvent) => {
      setRailWidth(clamp(startWidth + (move.clientX - startX), MIN_RAIL, MAX_RAIL));
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      stopOnBlur();
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    };
    // A drag cut short by the window going away has no `pointerup`; see
    // `endDragOnBlur`. The width already followed the pointer, so ending is enough.
    const stopOnBlur = endDragOnBlur(onUp);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  useEffect(() => {
    const pages = pdf?.pages.map((page) => page.text) ?? [];
    const nextHits = findHits(pages, searchQuery);
    setHits(nextHits);
    if (!searchOpen || !searchQuery.trim() || nextHits.length === 0) {
      setActiveHit(-1);
      return;
    }
    setActiveHit(0);
    goToHit(0, nextHits);
  }, [goToHit, pdf, searchOpen, searchQuery]);

  useLayoutEffect(() => {
    if (activeHit < 0) return;
    const scroller = scrollerRef.current;
    const marker = scroller?.querySelector<HTMLElement>(`[data-hit="${activeHit}"]`);
    if (marker) {
      scrollScrollerTo(marker, "center");
      window.setTimeout(() => {
        const hit = hits[activeHit];
        if (hit && jumpingToPage.current === hit.pageIndex) jumpingToPage.current = null;
      }, 400);
      return;
    }
    const hit = hits[activeHit];
    if (hit) goToPage(hit.pageIndex);
  }, [activeHit, goToPage, hits, scrollScrollerTo, zoom]);

  /**
   * The band's centre in stage coordinates: where the reading hole is drawn.
   *
   * The band's place on screen is its place on the page, so a content lock is what
   * it rides; the parked screen height is only the fallback for a band with no page
   * under it. `layoutFocusOverlay` draws the hole from this, and the column's own
   * toggle anchors on it — both have to agree on where the reader is.
   */
  const bandCenterY = useCallback((stage: HTMLElement): number => {
    const stageRect = stage.getBoundingClientRect();
    let centerY = parkedCenterYRef.current ?? stageRect.height / 2;
    const lock = contentLockRef.current;
    if (lock) centerY = stageYFromContentLock(stage, scrollerRef.current, lock) ?? centerY;
    return centerY;
  }, []);

  /**
   * The screen point a layout change scales the page around: the reader's place,
   * never the pointer.
   *
   * In focus mode the band *is* the passage being read, so its centre is what stays
   * put and the page shrinks or grows around it. Otherwise the reader is reading
   * from the top of the page area, and that line is what stays put. `zoomAnchorInArea`
   * carries the rest of the argument — in particular why the pointer must not decide
   * this, which is what used to walk the page down a step on every column toggle.
   */
  const layoutZoomAnchor = useCallback(
    (scroller: HTMLElement) => {
      const stage = stageRef.current;
      const bandY =
        focusModeRef.current && stage
          ? stage.getBoundingClientRect().top + bandCenterY(stage)
          : null;
      return zoomAnchorInArea(scroller.getBoundingClientRect(), bandY);
    },
    [bandCenterY],
  );

  /* A notes-column toggle is one change, not two.
   *
   * The page area narrows *and* the page scales, and both have to land in the same
   * commit: scaling from the resize observer instead paints the narrower column at
   * the old zoom first — the page shifts, an overflow scrollbar appears and goes,
   * then the page shrinks — which is what reads as the viewer flickering. A layout
   * effect runs after the new DOM but before the browser paints, so the page area
   * is never shown in the state nobody asked for.
   *
   * A *window* resize and the column's own drag never come through here, and both
   * keep the page's size: there the reader asked for room around the same page.
   * The observer below still measures those. */
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const scroller = scrollerRef.current;
    if (!stage || !scroller) return;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const previous = stageWidthRef.current;
    stageWidthRef.current = width;
    setStageSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
    // Nothing to scale: no document, or a viewer that is not on screen (the Notes
    // tab hides it, so its width reads as zero).
    if (!pdfRef.current || previous <= 0 || width <= 0) return;
    const next = zoomForArea(zoomRef.current, previous, width);
    if (Math.abs(next - zoomRef.current) < 1e-4) return;
    const point = layoutZoomAnchor(scroller);
    applyZoom(next, point.x, point.y);
  }, [applyZoom, layoutZoomAnchor, notesDetached, notesPanelOpen]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    /** Measure the page area. The column's own toggle is handled above. */
    const updateStageSize = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      stageWidthRef.current = width;
      setStageSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };

    updateStageSize();
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(stage);

    const pointFor = (event: Event) => {
      const rect = stage.getBoundingClientRect();
      const fallback = cursorRef.current ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const webkit = event as Partial<WebKitGestureEvent>;
      const mouse = event as Partial<MouseEvent>;
      const x = webkit.clientX ?? mouse.clientX ?? fallback.x;
      const y = webkit.clientY ?? mouse.clientY ?? fallback.y;
      return { x, y };
    };

    const onWheel = (event: WheelEvent) => {
      if (gestureActive.current) {
        event.preventDefault();
        return;
      }
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const intensity = event.deltaMode === 1 ? 0.05 : 0.0018;
      const factor = Math.exp(-event.deltaY * intensity);
      applyZoom(zoomRef.current * factor, event.clientX, event.clientY);
    };

    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureActive.current = true;
      gestureStartZoom.current = zoomRef.current;
    };

    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const { scale } = event as WebKitGestureEvent;
      const { x, y } = pointFor(event);
      applyZoom(gestureStartZoom.current * scale, x, y);
    };

    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      gestureActive.current = false;
    };

    const preventGesture = (event: Event) => event.preventDefault();

    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false });
    stage.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false });
    stage.addEventListener("gestureend", onGestureEnd as EventListener, { passive: false });
    document.addEventListener("gesturestart", preventGesture, { passive: false });
    document.addEventListener("gesturechange", preventGesture, { passive: false });

    return () => {
      observer.disconnect();
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("gesturestart", onGestureStart as EventListener);
      stage.removeEventListener("gesturechange", onGestureChange as EventListener);
      stage.removeEventListener("gestureend", onGestureEnd as EventListener);
      document.removeEventListener("gesturestart", preventGesture);
      document.removeEventListener("gesturechange", preventGesture);
    };
  }, [applyZoom]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;

      // The view switch works from either tab, so it comes before the guard
      // below that keeps the viewer's own shortcuts to the PDF tab.
      if (meta && (event.key === "1" || event.key === "2")) {
        event.preventDefault();
        switchView(event.key === "1" ? "pdf" : "notes");
        return;
      }
      // The notes surfaces (docked column, Notes tab, markdown popup) own the
      // keyboard while the event starts inside them: they bind their own ⌘F, ⌘S
      // and zoom keys, and typing a note must not also zoom the page or toggle
      // focus mode.
      const target = event.target instanceof Element ? event.target : null;

      /* Escape steps back **one layer** per press: the band's menu, the search
         bar, the notes column, then the reading strip — the order and the
         reasoning are in `escapeDismiss.ts`. The column before the strip is the
         case that matters: the panel is an aside raised from the passage being
         read, so the first press gives the page its window back and a second one
         leaves the mode. It sits above the notes-surface guard below on purpose:
         once a card has been clicked the press starts *inside* the column, and
         that is exactly when the column should go away.

         Two surfaces keep their own Escape, because each is holding text the
         reader is in the middle of writing: the markdown popup (which may have an
         unsaved note) and a note field or the inline card editor (where Escape
         means "drop this edit"). The popup is recognised by being open rather
         than by where the press started — its preview pane takes no focus, so a
         click there used to hand the key to the viewer, which closed the column
         behind the popup. */
      if (event.key === "Escape" && view === "pdf") {
        const keptByEditor = escapeKeptByEditor({
          noteDialogOpen: Boolean(document.querySelector(".note-backdrop")),
          typingInNotes:
            isTypingTarget(event.target) && Boolean(target?.closest(".doc-notes, .notes")),
        });
        if (keptByEditor) return;
        // Only claim the key when the press actually closed something.
        if (closeOverlays()) event.preventDefault();
        return;
      }

      /* One chord still reaches the viewer from inside the column: ⌘⌥M is how the
         column itself is raised and closed, so a press that starts in it — a card
         was just clicked, a note field has focus — has to land. Everything else
         stays the notes surfaces' own, and the markdown popup keeps this one too:
         it is modal, and closing the column behind it would move the page under
         the note being written. */
      if (
        view === "pdf" &&
        target?.closest(".doc-notes") &&
        panelShortcut(event) === "notes-panel"
      ) {
        event.preventDefault();
        event.stopPropagation();
        toggleNotesPanel();
        return;
      }

      if (target?.closest(".doc-notes, .notes, .note-backdrop")) return;

      if (view !== "pdf") return;

      // The two panel chords. Both move the same state their buttons do, and
      // both toggle: ⌘B closes the Pages rail when it is in the way and brings it
      // back, ⌘⌥M does the same for the notes column.
      const shortcut = panelShortcut(event);
      if (shortcut === "pages") {
        if (!pdf) return;
        event.preventDefault();
        event.stopPropagation();
        setShowThumbs((value) => !value);
        return;
      }
      if (shortcut === "notes-panel") {
        if (!pdf) return;
        event.preventDefault();
        event.stopPropagation();
        // Toggles the column when it is docked; when it is popped out, there is
        // nothing here to toggle, so the chord raises that window instead.
        toggleNotesPanel();
        return;
      }
      if (meta && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        openSearch();
        return;
      }
      if (searchOpen && meta && event.key.toLowerCase() === "g") {
        event.preventDefault();
        stepHit(event.shiftKey ? -1 : 1);
        return;
      }
      if (searchOpen && event.key === "Enter" && event.target === searchInputRef.current) {
        if (!event.shiftKey) return;
        event.preventDefault();
        stepHit(-1);
        return;
      }
      if (meta && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void openWithPicker();
        return;
      }
      if (meta && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        bumpZoom(ZOOM_STEP);
        return;
      }
      if (meta && event.key === "-") {
        event.preventDefault();
        bumpZoom(1 / ZOOM_STEP);
        return;
      }
      if (meta && event.key === "0") {
        event.preventDefault();
        fitWidth();
        return;
      }
      if (event.key.toLowerCase() === "f" && !meta && !event.altKey) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        toggleFocusMode();
        return;
      }
      if (event.key.toLowerCase() === "t" && !meta && !event.altKey) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        setShowThumbs((value) => !value);
        return;
      }
      if (
        event.code === "BracketLeft" ||
        event.code === "BracketRight" ||
        event.key === "[" ||
        event.key === "]"
      ) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        const direction = event.code === "BracketRight" || event.key === "]" ? 1 : -1;
        const step = event.altKey
          ? 1
          : STRIP_STEP * (event.shiftKey ? 3 : 1) * (meta ? 3 : 1);
        setStripHeight(stripHeightRef.current + direction * step);
        return;
      }
      if (focusMode && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        const distance = event.altKey
          ? 1
          : stripScreenPx(stripHeightRef.current, zoomRef.current);
        nudgeFocusStripRef.current((event.key === "ArrowDown" ? 1 : -1) * distance);
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    bumpZoom,
    closeOverlays,
    closeSearch,
    fitWidth,
    focusMode,
    openSearch,
    openWithPicker,
    pdf,
    searchOpen,
    setStripHeight,
    stepHit,
    switchView,
    toggleFocusMode,
    toggleNotesPanel,
    view,
  ]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !pdf) return;

    let frame = 0;
    const updateCurrentPage = () => {
      const pages = Array.from(scroller.querySelectorAll<HTMLElement>("[data-page]"));
      if (pages.length === 0) return;

      if (jumpingToPage.current !== null) {
        const target = pages.find((node) => Number(node.dataset.page) === jumpingToPage.current);
        const scrollerTop = scroller.getBoundingClientRect().top;
        if (target && Math.abs(target.getBoundingClientRect().top - scrollerTop) < 56) {
          jumpingToPage.current = null;
        } else {
          return;
        }
      }

      const anchor = scroller.getBoundingClientRect().top + Math.min(120, scroller.clientHeight * 0.22);
      let best = Number(pages[0]?.dataset.page) || 1;
      let bestDelta = Infinity;
      for (const node of pages) {
        const rect = node.getBoundingClientRect();
        const delta = Math.abs(rect.top - anchor);
        if (rect.top <= anchor && rect.bottom > anchor) {
          best = Number(node.dataset.page);
          break;
        }
        if (delta < bestDelta) {
          best = Number(node.dataset.page);
          bestDelta = delta;
        }
      }
      setCurrentPage((current) => (current === best ? current : best));
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateCurrentPage();
      });
    };

    updateCurrentPage();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [pdf, zoom, showThumbs, railWidth]);

  useEffect(() => {
    if (restoredLast.current) return;
    restoredLast.current = true;
    if (!isTauri()) return;
    const last = recents.find((doc) => doc.path);
    if (!last?.path) return;
    // Through the library like any other open: a Recents entry holding a legacy
    // path is upgraded here, before the viewer ever reads it.
    void openViaLibrary(last.path, last.name);
  }, [openViaLibrary, recents]);

  useEffect(() => {
    return () => {
      void pdfRef.current?.document.cleanup();
    };
  }, []);

  /**
   * Place the note badges: one per saved strip with a remark, on the strip's own
   * top edge at the left of its page.
   *
   * They are drawn in a layer above the reading band rather than inside the page,
   * because in focus mode the band covers the passage a badge belongs to and a
   * badge under it could not be clicked. The price is that the page cannot scroll
   * them: this is the pass that rewrites their place, from each page's box, on
   * every scroll frame and whenever the zoom, the stage or the strips change.
   *
   * A badge whose page is out of view is hidden instead of stacked up at the edge
   * of the stage, and one outside the reading hole is dimmed while focus mode is
   * on — still there, still clickable, but the reading line keeps the attention.
   */
  const layoutRemarkMarkers = useCallback(() => {
    const stage = stageRef.current;
    const scroller = scrollerRef.current;
    const nodes = remarkNodes.current;
    if (!stage || !scroller || nodes.size === 0) return;
    const stageRect = stage.getBoundingClientRect();
    const zoom = zoomRef.current || 1;
    const overlay = focusOverlayRef.current;
    /* The hole is read off the overlay's custom properties rather than measured
       again: `layoutFocusOverlay` wrote them, and it runs before this pass. */
    const holeTop = Number.parseFloat(overlay?.style.getPropertyValue("--hole-top") ?? "");
    const holeHeight = Number.parseFloat(overlay?.style.getPropertyValue("--hole-height") ?? "");
    const holeKnown = focusModeRef.current && Number.isFinite(holeTop) && Number.isFinite(holeHeight);
    const pageRects = new Map<number, DOMRect | null>();

    for (const strip of remarkedStripsRef.current) {
      const node = nodes.get(strip.id);
      if (!node) continue;
      let pageRect = pageRects.get(strip.page_number);
      if (pageRect === undefined) {
        const page = scroller.querySelector<HTMLElement>(`[data-page="${strip.page_number}"]`);
        pageRect = page ? page.getBoundingClientRect() : null;
        pageRects.set(strip.page_number, pageRect);
      }
      /* The strip's own top edge, in stage px: what the badge lines up with, and
         what decides whether it is under the veil — not the badge's own box, which
         sits above the edge and so would always count as outside the hole. */
      const edge = pageRect ? pageRect.top - stageRect.top + strip.top * zoom : Number.NaN;
      const visible =
        pageRect !== null &&
        pageRect.right > stageRect.left + 4 &&
        pageRect.left < stageRect.right - 4 &&
        edge > -REMARK_MARKER_SIZE &&
        edge < stageRect.height + REMARK_MARKER_SIZE;
      node.style.visibility = visible ? "visible" : "hidden";
      if (!visible || pageRect === null) continue;
      /* Its top edge on the strip's own: the badge hangs into the passage from the
         line rather than being cut in half by it, and never floats over the
         context above. */
      node.style.top = `${edge}px`;
      node.style.left = `${remarkMarkerLeft(pageRect.left - stageRect.left, stageRect.width)}px`;
      /* The line beside the badge *is* the passage's edge: it spans the strip's
         whole height, from its top edge to its bottom. */
      node.style.setProperty("--stem-height", `${Math.max(0, strip.height * zoom)}px`);
      node.classList.add("is-placed");
      const veiled = holeKnown && (edge < holeTop || edge > holeTop + holeHeight);
      node.classList.toggle("is-veiled", veiled);
    }
  }, []);

  const layoutFocusOverlay = useCallback(() => {
    const stage = stageRef.current;
    const overlay = focusOverlayRef.current;
    if (!stage || !overlay) return;
    const drag = dragLockRef.current;
    if (drag) {
      overlay.style.setProperty("--hole-top", `${drag.holeTop}px`);
      overlay.style.setProperty("--hole-height", `${drag.holeHeight}px`);
      return;
    }
    const height = stripScreenPx(stripHeightRef.current, zoomRef.current);
    const centerY = bandCenterY(stage);
    overlay.style.setProperty("--hole-top", `${centerY - height / 2}px`);
    overlay.style.setProperty("--hole-height", `${height}px`);
  }, [bandCenterY]);

  /**
   * The layout that follows the pointer: the band first, because the badge pass
   * reads the reading hole off it to dim the badges outside it.
   */
  const layoutOverlays = useCallback(() => {
    layoutFocusOverlay();
    layoutRemarkMarkers();
  }, [layoutFocusOverlay, layoutRemarkMarkers]);

  /**
   * Put a page point on the band line.
   *
   * A saved strip is opened by scrolling its page until the strip's own centre
   * sits on the strip line (`STRIP_LINE_FRACTION`, a fifth of the way down the
   * stage), leaving most of the page below the band. Scrolling the page to the
   * viewport top instead — what this did before — let the strip's position on its
   * page decide where the band landed, so walking through a list of strips
   * bounced both the band and the page around.
   *
   * Near the first or last page there is not enough document to scroll that far,
   * so the band is parked wherever the strip actually ended up: still on the
   * strip, just not on the line.
   */
  const alignStripUnderBand = useCallback(
    (node: HTMLElement, fracY: number) => {
      const scroller = scrollerRef.current;
      const stage = stageRef.current;
      if (!scroller || !stage) return;
      const stageRect = stage.getBoundingClientRect();
      const pageRect = node.getBoundingClientRect();
      // The strip is placed by its centre (that is what the band is drawn around,
      // and what it rides the page by), so half a band below the line is where the
      // band's *start* sits on it. Centring the band on the line instead pushed the
      // start of a tall strip out of the top of the viewport.
      const bandPx = stripScreenPx(stripHeightRef.current, zoomRef.current);
      const placement = placeStripPoint({
        stageHeight: stageRect.height,
        lineFraction: STRIP_LINE_FRACTION,
        pageTop: pageRect.top - stageRect.top,
        pageHeight: pageRect.height,
        fracY,
        pointOffsetPx: bandPx / 2,
        scrollTop: scroller.scrollTop,
        maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
      });
      scroller.scrollTop = placement.scrollTop;
      parkedCenterYRef.current = placement.centerY;
      layoutOverlays();
    },
    [layoutOverlays],
  );

  /**
   * Apply a scroll requested by opening a document or a saved strip.
   *
   * Declared down here, after the band's layout, because a strip restore has to
   * move the scroll and the band together.
   */
  useLayoutEffect(() => {
    const target = pendingPageRestore.current;
    if (target == null || !pdf || skipRestoreUntilZoom.current) return;
    const node = scrollerRef.current?.querySelector<HTMLElement>(`[data-page="${target}"]`);
    if (!node) return;
    const strip = pendingStripRestore.current;
    pendingPageRestore.current = null;
    pendingStripRestore.current = null;
    jumpingToPage.current = target;
    if (strip) alignStripUnderBand(node, strip.fracY);
    else scrollScrollerTo(node, "start");
    window.setTimeout(() => {
      if (jumpingToPage.current === target) jumpingToPage.current = null;
    }, 400);
  }, [pdf, zoom, restoreTick, scrollScrollerTo, alignStripUnderBand]);

  const nudgeFocusStrip = useCallback(
    (deltaY: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      const stageRect = stage.getBoundingClientRect();
      let current = parkedCenterYRef.current ?? stageRect.height / 2;
      const lock = contentLockRef.current;
      if (lock) current = stageYFromContentLock(stage, scrollerRef.current, lock) ?? current;
      const next = current + deltaY;
      const clientX = cursorRef.current?.x ?? stageRect.left + stageRect.width / 2;
      commitStripCenter(clientX, stageRect.top + next, next);
      layoutOverlays();
    },
    [commitStripCenter, layoutOverlays],
  );
  nudgeFocusStripRef.current = nudgeFocusStrip;

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    cursorRef.current = { x: event.clientX, y: event.clientY };
  };

  /**
   * `⌘` + left-drag chooses the display strip.
   *
   * The press is one edge of the area and the pointer the other, so the reader
   * sizes the band by drawing it: a paragraph, three lines, half a page — whatever
   * the drag covers becomes the reading hole. It works on the page and on the
   * band itself (in focus mode the hole is a surface, not a dead zone), which is
   * what makes re-choosing a strip one gesture instead of a dismissal and a
   * double-click.
   *
   * While the drag is live the area is drawn as a marquee (`.strip-select`,
   * `style` written per move, no render), and the band is committed on release
   * through exactly the path a paragraph double-click uses: the height in points,
   * and the centre parked on the page under the stage's middle. Committing only
   * on release is what keeps the band from following the pointer through a
   * gesture that was meant as a click.
   *
   * The geometry is `stripSelectBand`'s; this only measures the stage and hands
   * the result on.
   */
  const startStripSelect = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    // Non-null from here, but the handlers at the bottom of this function are
    // hoisted declarations, which TypeScript does not narrow through: this alias
    // is the reference they use.
    const host = stage;
    const target = event.target;
    // The search field and a note badge are controls of their own: a press on
    // them is theirs, `⌘` or not.
    if (
      target instanceof Element &&
      (target.closest(".search-bar") || target.closest(".remark-marker"))
    ) {
      return;
    }

    // No text selection and no native drag: the gesture is the app's.
    event.preventDefault();
    const pointerId = event.pointerId;
    host.setPointerCapture(pointerId);
    host.classList.add("selecting");
    window.getSelection()?.removeAllRanges();

    const marquee = stripSelectRef.current;
    const stageRect = host.getBoundingClientRect();
    const startY = event.clientY - stageRect.top;

    /** Draw one frame of the area, and keep it: the release commits the last one. */
    const show = (band: ReturnType<typeof stripSelectBand>) => {
      if (marquee) {
        marquee.style.display = band.chosen ? "block" : "none";
        marquee.style.top = `${band.top}px`;
        marquee.style.height = `${band.height}px`;
      }
      return band;
    };
    const measure = (clientY: number) => {
      const box = host.getBoundingClientRect();
      return stripSelectBand({
        startY,
        currentY: clientY - box.top,
        stageHeight: box.height,
        zoom: zoomRef.current || 1,
        minHeightPt: MIN_STRIP,
        maxHeightPt: MAX_STRIP,
      });
    };

    function detach() {
      host.classList.remove("selecting");
      if (marquee) marquee.style.display = "none";
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onCancel);
      stopOnBlur();
      if (host.hasPointerCapture(pointerId)) host.releasePointerCapture(pointerId);
    }

    // A marquee the window took away chooses nothing: there is no release point to
    // commit, so the same `detach` that ends a cancelled drag ends this one.
    const stopOnBlur = endDragOnBlur(detach);

    function onMove(move: PointerEvent) {
      show(measure(move.clientY));
    }

    function onUp(up: PointerEvent) {
      const box = host.getBoundingClientRect();
      const band = measure(up.clientY);
      detach();
      // A press that did not travel is a `⌘`-click: it chooses nothing and leaves
      // the strip exactly as it was.
      if (!band.chosen) return;

      const centerY = band.top + band.height / 2;
      stripHeightRef.current = band.heightPt;
      setStripHeight(band.heightPt);
      // The band rides the page under its centre. That point is the stage's own
      // middle rather than the pointer, because the area is the full width of the
      // stage and the pointer may have left the page sideways.
      commitStripCenter(box.left + box.width / 2, box.top + centerY, centerY);
      // A chosen area is a place to read, not a saved strip: a later resize writes
      // no row.
      setDisplayStripId(null);
      setFocusMode(true);
      layoutOverlays();
      requestAnimationFrame(layoutOverlays);
    }

    function onCancel() {
      detach();
    }

    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onCancel);
  };

  /**
   * Every press on the viewer, by button: `⌘` + left draws the strip, the middle
   * button pans it.
   */
  const onStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // `⌘` + left button: the drag that follows draws the strip (see
    // `startStripSelect`). `Ctrl` is the same key on other platforms, and is what
    // this app's other `⌘` shortcuts accept.
    if (pdf && event.button === 0 && (event.metaKey || event.ctrlKey)) {
      startStripSelect(event);
      return;
    }
    if (event.button !== 1 || !pdf) return;
    // Middle-button drag pans the document vertically. The scroll is a plain
    // scrollTop write, so the scroll spy and the strip's scroll re-layout both
    // pick it up exactly as they do for a wheel scroll. The band no longer takes
    // the press, so the gesture works inside the reading hole as well.
    const scroller = scrollerRef.current;
    const stage = stageRef.current;
    if (!scroller || !stage) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    stage.setPointerCapture(pointerId);
    stage.classList.add("panning");
    const startY = event.clientY;
    const startScrollTop = scroller.scrollTop;

    const onMove = (move: PointerEvent) => {
      scroller.scrollTop = startScrollTop - (move.clientY - startY);
    };
    const onUp = () => {
      stage.classList.remove("panning");
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stopOnBlur();
      if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
    };
    // The pan already scrolled; there is nothing to finish, only to stop — but the
    // `panning` cursor has to come off, which is what `onUp` does.
    const stopOnBlur = endDragOnBlur(onUp);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
  };

  /**
   * A wheel over the band scrolls the document, like a wheel over the page.
   *
   * The band lives in the focus overlay, a layer *beside* the scroller rather
   * than inside it, so a wheel over it has no scrollable ancestor to act on: with
   * the pointer over the reading hole the page simply would not scroll. The band
   * used to answer the press by moving instead, which is what made the hole a
   * dead zone for every gesture. It is not a drag surface any more, so the wheel
   * is handed to the scroller the pages live in — pixel deltas, both axes, and
   * the same line/page units a real scroller would apply — and the strip re-lays
   * out from the scroll event that follows, exactly as it does for any other
   * scroll.
   *
   * `Ctrl` / `⌘` + wheel is the zoom gesture, which the stage already owns: that
   * event is left alone so pinch-to-zoom over the band still zooms.
   */
  const onFocusWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1;
    // `Shift` + wheel is how a mouse scrolls sideways, which is the one thing a
    // real scroller does that the raw deltas do not say; a trackpad already
    // sends `deltaX` on its own.
    const sideways = event.shiftKey && event.deltaX === 0;
    scroller.scrollTop += (sideways ? 0 : event.deltaY) * unit;
    scroller.scrollLeft += (sideways ? event.deltaY : event.deltaX) * unit;
  };

  const onEdgeResize = (edge: "top" | "bottom") => (event: ReactPointerEvent<HTMLDivElement>) => {
    // `⌘` belongs to the other gesture: a drag that starts on a border chooses a
    // new area rather than resizing this one, so the press is left to the stage.
    if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
    const overlay = focusOverlayRef.current;
    const stage = stageRef.current;
    if (!overlay || !stage) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("dragging");
    overlay.classList.add("resizing");

    const startTop = Number.parseFloat(overlay.style.getPropertyValue("--hole-top")) || 0;
    const startHeight =
      Number.parseFloat(overlay.style.getPropertyValue("--hole-height")) ||
      stripScreenPx(stripHeightRef.current, zoomRef.current);
    const startBottom = startTop + startHeight;
    const pointerId = event.pointerId;
    const startPointerY = event.clientY;
    let lastPoint = { x: event.clientX, y: startPointerY };
    const grabbedEdgeY = stage.getBoundingClientRect().top + (edge === "top" ? startTop : startBottom);
    const grabOffset = startPointerY - grabbedEdgeY;
    const zoom = zoomRef.current || 1;
    const minHole = MIN_STRIP * zoom;
    const maxHole = MAX_STRIP * zoom;
    dragLockRef.current = { holeTop: startTop, holeHeight: startHeight };

    const applyHole = (clientX: number, clientY: number, commit: boolean) => {
      const stageRect = stage.getBoundingClientRect();
      const y = clientY - grabOffset - stageRect.top;
      let newTop = startTop;
      let newHole = startHeight;
      if (edge === "top") {
        newHole = clamp(startBottom - y, minHole, maxHole);
        newTop = startBottom - newHole;
      } else {
        newHole = clamp(y - startTop, minHole, maxHole);
        newTop = startTop;
      }
      const nextHeight = newHole / zoom;
      stripHeightRef.current = nextHeight;
      setStripHeight(nextHeight);
      dragLockRef.current = { holeTop: newTop, holeHeight: newHole };
      cursorRef.current = { x: clientX, y: clientY };
      if (commit) {
        const nextCenter = newTop + newHole / 2;
        commitStripCenter(clientX, stageRect.top + nextCenter, nextCenter);
      }
      layoutOverlays();
    };

    const onMove = (move: PointerEvent) => {
      lastPoint = { x: move.clientX, y: move.clientY };
      applyHole(lastPoint.x, lastPoint.y, false);
    };
    const onUp = (up: PointerEvent) => {
      applyHole(up.clientX, up.clientY, true);
      stop();
    };
    /** The drag ends: drop the classes and listeners, and keep the hole it chose. */
    const stop = () => {
      dragLockRef.current = null;
      handle.classList.remove("dragging");
      overlay.classList.remove("resizing");
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      stopOnBlur();
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      layoutOverlays();
    };
    // Interrupted, the resize commits at the last place the pointer was: the hole
    // is already that size on screen, so ending it anywhere else would snap it.
    const stopOnBlur = endDragOnBlur(() => {
      applyHole(lastPoint.x, lastPoint.y, true);
      stop();
    });
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const parkFocusAtPoint = useCallback(
    (clientX: number, clientY: number, target: EventTarget | null) => {
      if (!pdfRef.current) return false;
      if (!(target instanceof Element)) return false;
      // The band's note badge is its own click target: a double-click on it must
      // not also park the band under the pointer.
      if (
        target.closest(".search-bar") ||
        target.closest(".empty") ||
        target.closest(".remark-marker")
      ) {
        return false;
      }
      if (!target.closest(".page-shell") && !target.closest(".pages") && !target.closest(".focus-overlay")) {
        return false;
      }

      cursorRef.current = { x: clientX, y: clientY };
      const stage = stageRef.current;
      const stageRect = stage?.getBoundingClientRect();
      const pageEl = (target instanceof Element ? target.closest<HTMLElement>("[data-page]") : null)
        ?? pageElementAtPoint(scrollerRef.current, clientX, clientY);

      // Focusing a page makes it the current one, which scrolls the pages rail
      // to its thumbnail. No document scroll: the strip is parked where the
      // user just clicked, so moving the scroller would slide out from under it.
      const focusedPage = Number(pageEl?.dataset.page);
      if (Number.isFinite(focusedPage)) setCurrentPage(focusedPage);

      if (stage && stageRect && pageEl) {
        const pageRect = pageEl.getBoundingClientRect();
        const zoom = zoomRef.current || 1;
        const x = (clientX - pageRect.left) / zoom;
        const y = (clientY - pageRect.top) / zoom;
        const liveBoxes = paragraphBoxesFromTextLayer(pageEl, zoom);
        const fallbackBoxes = pdfRef.current?.pages.find(
          (page) => page.index === Number(pageEl.dataset.page),
        )?.text.runs ?? [];
        const paragraph = findParagraphAt(liveBoxes.length > 0 ? liveBoxes : fallbackBoxes, x, y, {
          minHeight: MIN_STRIP,
          maxHeight: MAX_STRIP,
        });
        if (paragraph) {
          const holeTop = pageRect.top - stageRect.top + paragraph.top * zoom;
          const holeHeight = paragraph.height * zoom;
          stripHeightRef.current = paragraph.height;
          setStripHeight(paragraph.height);
          const nextCenter = holeTop + holeHeight / 2;
          commitStripCenter(clientX, stageRect.top + nextCenter, nextCenter);
        } else {
          commitStripCenter(clientX, clientY, clientY - stageRect.top);
        }
      } else if (stage && stageRect) {
        commitStripCenter(clientX, clientY, clientY - stageRect.top);
      }
      window.getSelection()?.removeAllRanges();
      // A double-click parks the band on a passage, not on a row: whatever strip
      // it was showing before, this one has not been saved.
      setDisplayStripId(null);
      setFocusMode(true);
      layoutOverlays();
      requestAnimationFrame(layoutOverlays);
      return true;
    },
    [commitStripCenter, layoutOverlays, setStripHeight],
  );

  /**
   * Open a saved strip: put the display strip on it.
   *
   * Park the display strip on a saved strip, in the document that is already
   * open. Shared by the Notes tab (after it has opened the document), the docked
   * panel (where it always is), and a note badge's double-click.
   *
   * `keepScroll` parks the band where the strip already is on screen instead of
   * scrolling the page to bring the strip to the reading line. That is the badge's
   * case: the badge is hanging on the strip in view, so scrolling would move the
   * page out from under the passage the reader is looking at — and out from under
   * the badge they just pressed.
   */
  const parkSavedStrip = useCallback(
    (strip: FocusableStrip, options: { keepScroll?: boolean } = {}) => {
      const pageHeight = strip.page_height > 0 ? strip.page_height : 1;
      const fracY = (strip.top + strip.height / 2) / pageHeight;
      const lock = { page: strip.page_number, fracY };
      contentLockRef.current = lock;
      // The band now stands for this row: a resize is written back to it rather
      // than saved as another strip.
      setDisplayStripId(strip.id);
      setStripHeight(clamp(strip.height, MIN_STRIP, MAX_STRIP));
      setFocusMode(true);

      if (options.keepScroll) {
        // Where the strip's own centre is on screen right now, measured while the
        // page is still where the reader put it. The content lock is what keeps the
        // band there as the page moves afterwards.
        const stage = stageRef.current;
        parkedCenterYRef.current = stage
          ? stageYFromContentLock(stage, scrollerRef.current, lock)
          : null;
        layoutOverlays();
        requestAnimationFrame(layoutOverlays);
        return;
      }

      // The band has no screen position until the page is measured, which is what
      // the restore below does; until then it would draw in the old place.
      parkedCenterYRef.current = null;
      pendingStripRestore.current = { fracY };
      pendingPageRestore.current = strip.page_number;
      setRestoreTick((tick) => tick + 1);
    },
    [layoutOverlays],
  );

  /* ── the popped-out notes window ──────────────────────────────
     The main window stays the source of truth for everything the notes column
     needs to know: which PDF is open, which strip a badge asked to see, and
     which card should take the caret. It is sent as a snapshot; the data itself
     is fetched by each window from the backend, and kept fresh by the forwarded
     tag invalidations below. */

  /** The column has found and placed the card the badge asked for. */
  const clearReveal = useCallback(() => setRevealStripId(null), []);

  const notesContext: NotesContext = useMemo(
    () => ({
      document:
        pdf && openPath
          ? {
              filePath: openPath,
              documentName: pdf.sourceName ?? APP_TITLE,
              pageCount: pdf.pages.length,
            }
          : null,
      pathless: !!pdf && !openPath,
      revealId: revealStripId,
      pendingEditId: pendingNoteEditId,
    }),
    [openPath, pdf, pendingNoteEditId, revealStripId],
  );
  const latestContextRef = useRef(notesContext);
  latestContextRef.current = notesContext;

  /** A stable handle on `parkSavedStrip` for the long-lived event subscription. */
  const parkSavedStripRef = useRef(parkSavedStrip);
  parkSavedStripRef.current = parkSavedStrip;

  /**
   * Dock the panel again when its window goes away.
   *
   * `tauri://destroyed` rather than `close-requested`: the requirement is about
   * the window being gone, however it went — the traffic light, the dock button,
   * ⌘⌥M inside it, or Rust closing it after the main window went down.
   */
  const watchNotesWindowClose = useCallback(async (win: WebviewWindow) => {
    const unlisten = await win.once("tauri://destroyed", () => {
      setNotesDetached(false);
      // The reader asked for these notes and then closed the window that was
      // showing them; the column comes back open rather than merely available.
      setNotesPanelOpen(true);
    });
    return unlisten;
  }, []);

  const detachNotes = useCallback(async () => {
    try {
      const win = await openNotesWindow(loadNotesWindowRect());
      setNotesDetached(true);
      setNotesPanelOpen(false);
      // Watched for the window's whole life, so no cleanup is kept here.
      await watchNotesWindowClose(win);
    } catch (cause) {
      console.error(cause);
      // Staying docked is the useful failure: the column is still on screen.
      setSavedToast("Could not open the notes window.");
    }
  }, [watchNotesWindowClose]);

  useEffect(() => {
    if (!notesDetached) return;
    void emitToNotes(NotesEvent.Context, notesContext);
  }, [notesContext, notesDetached]);

  useEffect(
    () =>
      subscribe(NotesEvent.Ready, () => {
        // The window mounted after the last snapshot was sent, so it is asking
        // for the current one. The ref keeps this handler independent of the
        // context, which changes on every badge click.
        const latest = latestContextRef.current;
        if (latest) void emitToNotes(NotesEvent.Context, latest);
      }),
    [],
  );

  useEffect(
    () =>
      subscribe<{ strip: FocusableStrip }>(NotesEvent.OpenStrip, ({ strip }) => {
        parkSavedStripRef.current(strip);
        // The band just moved in *this* window; without the focus the reader is
        // looking at a card in the other one and nothing appears to happen.
        if (isTauri()) {
          void getCurrentWindow()
            .setFocus()
            .catch((cause) => console.error(cause));
        }
      }),
    [],
  );

  useEffect(() => subscribe(NotesEvent.RevealHandled, () => clearReveal()), [clearReveal]);

  useEffect(
    () => subscribe(NotesEvent.PendingEditHandled, () => setPendingNoteEditId(null)),
    [],
  );

  useEffect(
    () =>
      subscribe<InvalidatePayload>(NotesEvent.Invalidate, (payload) => {
        applyRemoteInvalidation(dispatch, payload.types);
      }),
    [dispatch],
  );

  /**
   * The main webview was (re)loaded while the notes window was still open — in
   * dev, every edit does this. Adopt the existing window instead of forgetting
   * about it: it is still on screen, and closing it must still dock the panel.
   */
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getNotesWindow()
      .then(async (win) => {
        if (!win || cancelled) return;
        setNotesDetached(true);
        const off = await watchNotesWindowClose(win);
        if (cancelled) off();
        else unlisten = off;
      })
      .catch((cause) => console.error(cause));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [watchNotesWindowClose]);

  /**
   * Show the remark a badge is announcing.
   *
   * The notes column opens on that strip's card: `StripList` owns the rest of it
   * — opening the card's folder, selecting it, and putting it on the column's
   * reading line — because it owns the list. The band and the page are left
   * alone: the badge is a note about a passage, not a request to scroll to it.
   */
  const openRemark = useCallback(
    (strip: FocusableStrip) => {
      showNotes();
      setRevealStripId(strip.id);
    },
    [showNotes],
  );

  /**
   * The badge's click: ask the column for the note — after the delay that a
   * double-click needs, when the answer would be to open the column.
   *
   * A badge is one control with two actions, and a double-click begins with the
   * click that would open the column. So a click that would *open* it waits
   * `REMARK_CLICK_DELAY_MS`; the second press drops it, and the band is parked
   * instead. Without the wait the column would slide open — and the page reflow
   * with it — on the way to a strip the reader asked to see on the page.
   *
   * A column that is already open has nothing to reflow: the click only reveals
   * a card in it, so it answers at once and a double-click simply does both.
   */
  const onRemarkClick = useCallback(
    (strip: FocusableStrip, event: ReactMouseEvent<HTMLButtonElement>) => {
      // `detail` is 0 for a keyboard activation (Enter / Space), which can never
      // be the first half of a double-click: answer it at once. A popped-out
      // column counts as open for the same reason an open one does: nothing in
      // this window reflows, so there is no slide to wait out.
      if (event.detail === 0 || notesOnScreen) {
        openRemark(strip);
        return;
      }
      // The second press of a double-click: the delay on the first is still
      // running and `onRemarkDoubleClick` is about to drop it.
      if (remarkClickTimer.current !== null) return;
      remarkClickTimer.current = window.setTimeout(() => {
        remarkClickTimer.current = null;
        openRemark(strip);
      }, REMARK_CLICK_DELAY_MS);
    },
    [notesOnScreen, openRemark],
  );

  /**
   * The badge's double-click: put the saved strip itself on the page.
   *
   * Where it is, not at the reading line: the badge is hanging on that strip, so
   * the page stays exactly where it is and the band appears on the passage under
   * the pointer.
   */
  const onRemarkDoubleClick = useCallback(
    (strip: FocusableStrip) => {
      if (remarkClickTimer.current !== null) {
        window.clearTimeout(remarkClickTimer.current);
        remarkClickTimer.current = null;
      }
      parkSavedStrip(strip, { keepScroll: true });
    },
    [parkSavedStrip],
  );

  const openStripFromNotes = useCallback(
    async (document: PdfDocumentListItem, strip: FocusableStrip) => {
      switchView("pdf");

      // A legacy document's path changes during the open — it is upgraded to its
      // library copy — so the open has to answer for itself rather than being
      // checked afterwards against `document.file_path`.
      const alreadyOpen = openDocRef.current?.path === document.file_path;
      if (!alreadyOpen && !(await openViaLibrary(document.file_path, document.name))) {
        // The file moved or was deleted; the open already said so.
        switchView("notes");
        return;
      }

      parkSavedStrip(strip);
    },
    [openViaLibrary, parkSavedStrip],
  );

  /**
   * Save the display strip, then hand the note over to its card.
   *
   * No dialog: the row is written immediately, the "Notes of this PDF" column
   * opens, and the new card's remark field takes focus. Cancelling the note
   * therefore leaves a saved strip with no note, which is a valid state.
   *
   * A band that is already showing a saved row — a card was clicked, or this
   * strip was saved a moment ago — is not saved twice: the new geometry is
   * written back to that row (`PATCH`) and nothing else moves. Opening the
   * column would reflow the page the reader just resized against, so the
   * confirmation is the toast and the remark badge following the band.
   *
   * The document row is resolved through the same cached query the notes panel
   * uses, so saving a strip and opening the panel cost one upsert between them.
   */
  const saveDisplayStrip = useCallback(async () => {
    const loaded = pdfRef.current;
    const lock = contentLockRef.current;
    const open = openDocRef.current;

    if (!loaded || !lock || !open) {
      setStripSaveState("error");
      setStripSaveMessage("Double-click a paragraph first, so there is a strip to save.");
      return;
    }

    const page = loaded.pages.find((candidate) => candidate.index === lock.page);
    if (!page) {
      setStripSaveState("error");
      setStripSaveMessage(`Page ${lock.page} is not loaded.`);
      return;
    }

    if (!open.path) {
      setStripSaveState("error");
      setStripSaveMessage("This document has no file path, so a strip cannot be stored yet.");
      return;
    }

    setStripSaveState("saving");
    setStripSaveMessage(null);
    setStripMenu(null);

    try {
      const geometry = savedStripGeometry(page, lock.fracY * page.height, stripHeightRef.current);
      const { text_excerpt, ...rest } = geometry;

      if (displayStripId !== null) {
        // Only the geometry is sent: the note this row already carries is not
        // part of a resize, and the endpoint writes just the fields it is given.
        await updateStrip({ id: displayStripId, ...rest, text_excerpt }).unwrap();
        setStripSaveState("saved");
        setStripSaveMessage(`Updated page ${geometry.page_number}.`);
        setSavedToast(`Updated page ${geometry.page_number}.`);
        return;
      }

      const document = await resolveDocument({
        file_path: open.path,
        name: open.name,
        page_count: loaded.pages.length,
        fingerprint: loaded.document.fingerprints[0] ?? undefined,
      }).unwrap();

      // The API takes an optional string, so "no text under the strip" is an
      // absent field rather than an explicit null.
      const saved = await createStrip({
        pdf_document_id: document.id,
        ...rest,
        ...(text_excerpt === null ? {} : { text_excerpt }),
      }).unwrap();

      // The band now stands on a row, so a resize is an update from here on.
      setDisplayStripId(saved.id);
      setStripSaveState("saved");
      setStripSaveMessage(`Saved page ${geometry.page_number}.`);
      // Show the column and let the new card's field take the caret. When the
      // column is popped out, `showNotes` raises that window: the caret has to
      // land in the window the reader is looking at.
      showNotes();
      setPendingNoteEditId(saved.id);
    } catch (cause) {
      // The click that asked closes the menu, so a failed write is reported where
      // it can still be seen: the menu keeps it for the next open, the toast
      // shows it now.
      const message =
        apiErrorMessage(cause) ??
        (displayStripId !== null ? "Could not update the strip." : "Could not save the strip.");
      // A row deleted behind the band (its card's **Delete strip**) cannot be
      // updated again: forget it, so the next click saves the passage instead of
      // failing forever against an id that is gone.
      if (displayStripId !== null && (cause as { status?: unknown } | null)?.status === 404) {
        setDisplayStripId(null);
      }
      setStripSaveState("error");
      setStripSaveMessage(message);
      setSavedToast(message);
    }
  }, [createStrip, displayStripId, resolveDocument, showNotes, updateStrip]);

  /** Right-click on the display strip opens the menu at the cursor. */
  const onStripContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setStripSaveState("idle");
    setStripSaveMessage(null);
    setStripMenu({ x: event.clientX, y: event.clientY });
  };

  const onStageDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    parkFocusAtPoint(event.clientX, event.clientY, event.target);
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let suppressSelection = false;
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) {
        suppressSelection = false;
        return;
      }
      const target = event.target;
      const inSearch = target instanceof Element && target.closest(".search-bar");
      // A note badge reaches this too (its guard is in `parkFocusAtPoint`): it
      // still wants the press captured, or WebKit starts Look Up on the second
      // one, but the badge's own double-click is what answers it.
      suppressSelection = event.detail >= 2 && !inSearch;
      if (!suppressSelection) return;
      // Capture the second press before WebKit starts Look Up or a page-wide
      // selection, both of which dim the window while the button is held.
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      parkFocusAtPoint(event.clientX, event.clientY, event.target);
    };
    const onSelectStart = (event: Event) => {
      if (!suppressSelection) return;
      event.preventDefault();
    };
    stage.addEventListener("mousedown", onMouseDown, true);
    stage.addEventListener("selectstart", onSelectStart, true);
    return () => {
      stage.removeEventListener("mousedown", onMouseDown, true);
      stage.removeEventListener("selectstart", onSelectStart, true);
    };
  }, [parkFocusAtPoint]);

  /* A click outside the band no longer turns the strip off.
   *
   * Any click in the dark veil used to end the session, which made the page
   * itself unusable while reading: a click that missed the hole — reaching for a
   * word above it, clicking between two paragraphs — closed the strip the reader
   * was in the middle of. Leaving focus mode is now only ever deliberate: `Esc`
   * (through `closeOverlays` above, which also takes the menu, the search bar and
   * the notes column with it), `F`, or the toolbar's **Focus** toggle.
   *
   * So a click beside the band is the page's own again. The veil is drawn by
   * `.focus-overlay`, which takes no pointer events, so the press lands on the
   * page under it: it selects text, it does not move the strip — and a
   * double-click still *moves* the band to the paragraph that was hit
   * (`parkFocusAtPoint`), which parks the new strip without needing the old one
   * cleared first.
   */

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find(isPdfFile);
    if (file) await onHtmlFile(file);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const path = event.payload.paths.find(isPdfPath);
        if (path) void openViaLibrary(path);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((cause) => {
        console.error(cause);
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [openViaLibrary]);

  /* Everything the viewport decides: the band's own layout, and the badges that
     hang off it — a resize (window, pages rail, notes column), a zoom, a new
     height or lock, a different strip list, a newly opened document. */
  useLayoutEffect(() => {
    if (focusMode) layoutFocusOverlay();
    layoutRemarkMarkers();
  }, [
    focusMode,
    layoutFocusOverlay,
    layoutRemarkMarkers,
    pdf,
    remarked,
    stageSize,
    stripHeight,
    zoom,
  ]);

  /* And everything the scroll decides. The band rides the page, so its screen
     position is recomputed on every scroll, and the badges are pinned to their
     pages the same way — as long as the document has any. */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (!focusMode && remarked.length === 0) return;
    const onScroll = () => {
      if (focusMode) layoutFocusOverlay();
      layoutRemarkMarkers();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [focusMode, layoutFocusOverlay, layoutRemarkMarkers, pdf, remarked, zoom]);

  /**
   * Widest the column may be right now, in px.
   *
   * The column is docked beside the page, so the two split the row they sit in:
   * the stage is what is left of that row, and adding the column back gives the
   * width both are dividing. That sum is an invariant of the layout, which is why
   * this number holds still while the column is dragged, opened or closed, and
   * why the ceiling means the same thing in all three.
   *
   * `null` when the viewer is not on screen to measure — the Notes tab hides it —
   * in which case callers leave a width alone rather than clamping it against a
   * box nobody can see.
   */
  const notesPanelMaxWidth = useCallback((): number | null => {
    const stageWidth = stageRef.current?.getBoundingClientRect().width ?? 0;
    if (stageWidth <= 0) return null;
    // Closed, the column has no box to measure, and the stage already is the row.
    const columnWidth = notesPaneRef.current?.getBoundingClientRect().width ?? 0;
    return maxNotesPanelWidth(stageWidth + columnWidth);
  }, []);

  // The column width is remembered in the backend rather than in the webview's
  // storage, so it follows the profile; a missing or unreadable value just keeps
  // the default. Applied once, so a later invalidation cannot fight a drag.
  useEffect(() => {
    if (notesPanelWidthLoaded.current || !appState) return;
    notesPanelWidthLoaded.current = true;
    const stored = Number(appState[NOTES_PANEL_WIDTH_KEY]);
    if (Number.isFinite(stored) && stored > 0) {
      setNotesPanelWidth(clamp(stored, MIN_NOTES_PANEL, notesPanelMaxWidth() ?? maxNotesPanelWidth(0)));
    }
  }, [appState]);

  /**
   * A width is remembered, the window is not: a column dragged wide on a large
   * screen would hang off the edge of a small one. The ceiling the drag uses is
   * re-applied whenever the viewer changes size, so the column is never wider than
   * the page area it covers — and a width that already fits is left untouched.
   */
  useLayoutEffect(() => {
    const max = notesPanelMaxWidth();
    if (max === null) return;
    setNotesPanelWidth((width) => (width > max ? max : width));
  }, [stageSize, notesPanelMaxWidth]);

  /**
   * Drag the panel's left edge. The width lives in state while dragging (so the
   * page reflows live) and is written once, on release, so a drag is one write
   * instead of one per pointer move.
   */
  const onNotesPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pane = notesPaneRef.current;
    if (!pane) return;
    event.preventDefault();
    const handle = event.currentTarget;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // The pointer can already be gone; the listeners below still work.
    }
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = pane.getBoundingClientRect().width;
    // Measured once, at the press: the row the page and the column split cannot
    // change size mid-drag.
    const maxWidth = notesPanelMaxWidth() ?? maxNotesPanelWidth(0);
    let width = startWidth;

    const onMove = (move: PointerEvent) => {
      // Dragging left widens this column: the seam moves towards the page, so the
      // page gives up what the column takes. The floor is 0, not the minimum:
      // dragging all the way in is how the column is closed, and it should follow
      // the pointer while it happens.
      width = clamp(startWidth + (startX - move.clientX), 0, maxWidth);
      if (width >= MIN_NOTES_PANEL) lastNotesPanelWidthRef.current = width;
      setNotesPanelWidth(width);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      stopOnBlur();
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      if (Math.abs(width - startWidth) < 1) return;

      const settled = resolveNotesPanelDrag(width, maxWidth);
      if (settled.kind === "close") {
        // Dragged shut: close the column, and put the width back so reopening it
        // from the toolbar brings it back at a usable size.
        setNotesPanelWidth(restoredNotesPanelWidth(lastNotesPanelWidthRef.current, maxWidth));
        setNotesPanelOpen(false);
        return;
      }

      setNotesPanelWidth(settled.width);
      lastNotesPanelWidthRef.current = settled.width;
      // Fire and forget: forgetting the width only means the next launch starts
      // at the default.
      void putAppState({ key: NOTES_PANEL_WIDTH_KEY, value: String(settled.width) });
    };
    // Interrupted, the column settles where the drag left it: the width is already
    // that on screen, and `onUp` is what writes it down.
    const stopOnBlur = endDragOnBlur(onUp);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  useEffect(() => {
    if (pageInputRef.current === document.activeElement) return;
    setPageDraft(String(currentPage));
  }, [currentPage]);

  const hitsByPage = useMemo(() => {
    const map = new Map<number, Array<{ index: number; boxes: SearchBox[] }>>();
    hits.forEach((hit, index) => {
      const list = map.get(hit.pageIndex) ?? [];
      list.push({ index, boxes: hit.boxes });
      map.set(hit.pageIndex, list);
    });
    return map;
  }, [hits]);

  /** "Save note" or "Update note": the band menu's action for this band. */
  const menuCopy = stripMenuCopy(displayStripId !== null);

  return (
    <div
      className="app"
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Stands in for the native title bar we hide in tauri.conf.json: it is
          what makes the window draggable, and what shows the open document. */}
      <TitleBar
        title={pdf?.sourceName ?? APP_TITLE}
        tab={view}
        onTabChange={switchView}
      />
      {busy && <div className="loading-bar" />}
      {/* The PDF view stays mounted while the Notes tab is open: unmounting the
          scroller would throw away every rendered page canvas and the scroll
          position, for a tab switch that should be instant. */}
      <div className={`pdf-view${view === "pdf" ? "" : " is-hidden"}`}>
      <header className="toolbar">
        <div className="toolbar-cluster">
          <button className="primary" onClick={() => void openWithPicker()}>
            Open PDF
          </button>
          {/* No "Recents" caption: the control already reads "Open recent…",
              and the row has better uses for the width. */}
          <label className="recents-picker">
            <select
              value=""
              disabled={recents.length === 0}
              onChange={(event) => {
                const path = event.target.value;
                event.target.value = "";
                if (!path) return;
                void openViaLibrary(path);
              }}
            >
              <option value="">
                {recents.length ? "Open recent…" : "No recents"}
              </option>
              {recents.map((doc) => (
                <option
                  key={doc.path ?? doc.name}
                  value={doc.path ?? ""}
                  disabled={!doc.path}
                >
                  {doc.name}
                </option>
              ))}
            </select>
          </label>
          <button className="ghost close-doc" onClick={closePdf} disabled={!pdf}>
            Close
          </button>
        </div>

        <div className="toolbar-cluster page-meta">
          <div className="file-meta">
            {pdf ? (
              <form
                className="page-jump"
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = Number.parseInt(pageDraft, 10);
                  if (!Number.isFinite(next)) {
                    setPageDraft(String(currentPage));
                    return;
                  }
                  goToPage(clamp(Math.round(next), 1, pdf.pages.length));
                  pageInputRef.current?.blur();
                }}
              >
                <input
                  ref={pageInputRef}
                  type="text"
                  inputMode="numeric"
                  value={pageDraft}
                  aria-label="Page number"
                  onChange={(event) => setPageDraft(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={() => setPageDraft(String(currentPage))}
                />
                <span>/ {pdf.pages.length}</span>
              </form>
            ) : (
              "No document open"
            )}
          </div>
          {error && <span className="status-error">{error}</span>}
        </div>

        <div className="toolbar-cluster">
          <button
            className={focusMode ? "ghost active" : "ghost"}
            onClick={toggleFocusMode}
            aria-pressed={focusMode}
            disabled={!pdf}
          >
            Focus
          </button>
          <label className="strip-control strip-blur" title="Backdrop blur on the veil outside the reading strip.">
            <span>Blur</span>
            <input
              type="range"
              min={MIN_BLUR}
              max={MAX_BLUR}
              value={Math.round(stripBlur)}
              disabled={!pdf}
              aria-label="Blur"
              onChange={(event) => setBlurRadius(Number(event.target.value))}
            />
            <span className="strip-readout">{Math.round(stripBlur)} px</span>
          </label>
        </div>

        <div className="toolbar-cluster">
          {/* Icons rather than the `−` / `+` characters: a glyph sits on the
              font's baseline in whatever width the font gives it, so the two
              halves of one control were different sizes and neither was centred
              in its square. A 16px stroked icon is the same mark in both. */}
          <button className="icon" onClick={() => bumpZoom(1 / ZOOM_STEP)} disabled={!pdf} aria-label="Zoom out">
            <Minus size={16} aria-hidden />
          </button>
          <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
          <button className="icon" onClick={() => bumpZoom(ZOOM_STEP)} disabled={!pdf} aria-label="Zoom in">
            <Plus size={16} aria-hidden />
          </button>
          <button className="ghost" onClick={fitWidth} disabled={!pdf}>
            Fit
          </button>
          <button
            className={searchOpen ? "ghost active" : "ghost"}
            onClick={openSearch}
          >
            Find
          </button>
        </div>

        {/* Its own control, pinned to the right edge: it opens a panel rather
            than changing the page, so it should not read as part of the
            zoom/find cluster. Popped out, it is pressed either way — the notes
            are on screen, just in another window — and its click raises that
            window instead of toggling a column that is not here. */}
        <button
          className={`ghost notes-toggle${notesOnScreen ? " active" : ""}`}
          onClick={toggleNotesPanel}
          aria-pressed={notesOnScreen}
          disabled={!pdf}
          title="Notes of this PDF — saved strips beside the page (⌘⌥M)"
        >
          <ListTree size={14} />
          <span className="notes-toggle-label">Notes of this PDF</span>
        </button>
      </header>

      <div className="workspace">
        {pdf && showThumbs && (
          <aside
            className="thumbs-pane"
            ref={railPaneRef}
            style={{ width: railWidth }}
          >
            <div className="thumbs-head">
              {/* The rail's own label, doubling as the control that closes it:
                  text, not a button-shaped box (see `.thumbs-label`). */}
              <button
                className="thumbs-label"
                onClick={() => setShowThumbs(false)}
                aria-pressed="true"
                title="Pages (⌘B)"
              >
                Pages
              </button>
            </div>
            <nav className="thumbs" aria-label="Page thumbnails">
              {pdf.pages.map((page) => (
                <ThumbnailView
                  key={`${pdf.sourceName}-thumb-${page.index}`}
                  page={page}
                  width={thumbWidth}
                  active={page.index === currentPage}
                  onSelect={goToPage}
                />
              ))}
            </nav>
            {/* The backend pill lives at the bottom of this column instead of in
                a bar of its own: the rail already runs the window's full height,
                and a row across the bottom cost the page 30px of its own. */}
            <div className="rail-status">
              <BackendStatusChip compact />
            </div>
            <div
              className="thumbs-resizer"
              onPointerDown={onRailResize}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize page thumbnails"
            />
          </aside>
        )}
        {pdf && !showThumbs && (
          <div className="thumbs-collapsed">
            <button className="thumbs-label" onClick={() => setShowThumbs(true)} title="Pages (⌘B)">
              Pages
            </button>
            {/* A sliver of rail has no width for a label: the dot alone still says
                the backend is up, and its tooltip carries the address. */}
            <div className="rail-status">
              <BackendStatusChip compact />
            </div>
          </div>
        )}
        <div
          className="stage"
          ref={stageRef}
          onPointerDown={onStagePointerDown}
          onPointerMove={onPointerMove}
          onDoubleClick={onStageDoubleClick}
          onContextMenu={(event) => event.preventDefault()}
        >
          {searchOpen && (
            <SearchBar
              committedQuery={searchQuery}
              onCommit={commitSearchQuery}
              onStep={stepHit}
              onClose={closeSearch}
              inputRef={searchInputRef}
              activeHit={activeHit}
              hitCount={hits.length}
            />
          )}
          <div className="scroller" ref={scrollerRef}>
            {pdf ? (
              <div className="pages" style={{ ["--zoom" as string]: String(zoom) }}>
                {pdf.pages.map((page) => (
                  <PdfPageView
                    key={`${pdf.sourceName}-${page.index}`}
                    page={page}
                    renderZoom={renderZoom}
                    hits={hitsByPage.get(page.index) ?? NO_HITS}
                    activeHit={activeHit}
                  />
                ))}
              </div>
            ) : (
              <div className="empty">
                <div className="empty-card">
                  <h1>Read one line at a time.</h1>
                  <p>
                    Open a PDF, pinch to zoom, then double-click a paragraph to park
                    the reading strip around that block. Right-click the strip to save
                    it as a record for this document. The strip rides the page as
                    you scroll, so it stays on the passage it was parked on.
                    Everything else sits under a 70% veil.
                  </p>
                  <button className="primary" onClick={() => void openWithPicker()}>
                    Choose a PDF
                  </button>
                  {recents.length > 0 && (
                    <div className="recent-list">
                      <div className="recent-heading">Recent documents</div>
                      {recents.map((doc) => (
                        <button
                          key={`${doc.openedAt}-${doc.path ?? doc.name}`}
                          className="ghost recent-item"
                          disabled={!doc.path}
                          onClick={() => doc.path && void openViaLibrary(doc.path, doc.name)}
                        >
                          <span title={doc.name}>{doc.name}</span>
                          {/* A library path is the app's own copy named by its
                              hash: worth opening, meaningless to read, so the
                              row shows the name alone. */}
                          {doc.path && !isLibraryPath(doc.path) && (
                            <em title={doc.path}>{doc.path}</em>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="hints">
                    <div>Drop a file here · <kbd>⌘</kbd><kbd>O</kbd> to open</div>
                    <div>Double-click a paragraph to focus · <kbd>⌘</kbd> drag to draw the strip · right-click the band to save it as a note · middle-drag to pan · drag a border to resize · <kbd>Esc</kbd> closes the panel, then the strip · <kbd>F</kbd> toggle · <kbd>T</kbd> pages</div>
                    <div><kbd>⌘</kbd><kbd>F</kbd> find · <kbd>⌘</kbd><kbd>B</kbd> pages · <kbd>⌘</kbd><kbd>⌥</kbd><kbd>M</kbd> notes of this PDF</div>
                    <div><kbd>[</kbd> <kbd>]</kbd> strip · <kbd>⌥[</kbd> 1 pt · <kbd>⌥↑</kbd> 1px · <kbd>⌘[</kbd> ×3 · <kbd>↑</kbd> <kbd>↓</kbd> move</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* One badge per saved strip with a remark, on the passage it belongs
              to. A layer of its own, above the veil: in focus mode the band covers
              the strip the badge sits on, and a badge under it could not be
              clicked. `layoutRemarkMarkers` places it, because a layer cannot ride
              the page's own scroll. */}
          {pdf && remarked.length > 0 && (
            <div className="remark-layer" role="group" aria-label="Remarks of this PDF">
              {remarked.map((strip) => (
                <button
                  key={strip.id}
                  type="button"
                  ref={(node) => {
                    if (node) remarkNodes.current.set(strip.id, node);
                    else remarkNodes.current.delete(strip.id);
                  }}
                  className="remark-marker"
                  title={`Page ${strip.page_number} — ${noteSummary(strip.remark, 140)}\nClick to show it in Notes of this PDF, double-click to put the strip on the page.`}
                  aria-label={`Remark on page ${strip.page_number}: ${noteSummary(strip.remark, 60)}. Click to show it in Notes of this PDF, double-click to put the strip on the page.`}
                  onClick={(event) => onRemarkClick(strip, event)}
                  onDoubleClick={() => onRemarkDoubleClick(strip)}
                >
                  {/* The face is what grows under the pointer; the line below it
                      must keep the length the strip gave it. */}
                  <span className="remark-marker-face">
                    <StickyNote size={14} aria-hidden />
                  </span>
                </button>
              ))}
            </div>
          )}

          {pdf && focusMode && (
            <div
              className="focus-overlay"
              ref={focusOverlayRef}
              onWheel={onFocusWheel}
              style={{ ["--focus-strip-blur" as string]: `${stripBlur}px` }}
            >
              <div className="focus-mask" aria-hidden />
              {/* The band is the reading hole's surface: the two resize borders
                  inside it, and the right-click target that saves the strip as a
                  note. It is deliberately *not* a drag handle any more — a press
                  here only presses, so the wheel (`onFocusWheel`) and the
                  middle-button pan reach the page, and the strip is moved with
                  `↑` / `↓` or by parking it on another paragraph. */}
              <div className="focus-band" onContextMenu={onStripContextMenu}>
                <div
                  className="focus-edge focus-edge-top"
                  onPointerDown={onEdgeResize("top")}
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize reading strip from top"
                />
                <div
                  className="focus-edge focus-edge-bottom"
                  onPointerDown={onEdgeResize("bottom")}
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize reading strip from bottom"
                />
              </div>
              <div className="focus-mask" aria-hidden />
            </div>
          )}

          {/* The area a `⌘`-drag is drawing, above the veil so its edges are
              visible over whatever it crosses. Position comes from the drag
              (`startStripSelect` writes `top` and `height` per move), the element
              is here always so the first frame of a fast drag is not lost, and it
              never takes a pointer event of its own. */}
          <div className="strip-select" ref={stripSelectRef} aria-hidden="true" />

          {stripMenu && (
            <div
              className="strip-menu"
              ref={stripMenuRef}
              style={{ left: stripMenu.x, top: stripMenu.y }}
              role="menu"
              aria-label="Display strip actions"
            >
              <button
                type="button"
                className="strip-menu-item"
                role="menuitem"
                disabled={stripSaveState === "saving"}
                onClick={() => void saveDisplayStrip()}
              >
                {stripSaveState === "saving" ? menuCopy.busy : menuCopy.action}
              </button>
              <div
                className={`strip-menu-note${stripSaveState === "error" ? " is-error" : ""}`}
                role="status"
              >
                {stripSaveMessage ?? menuCopy.hint}
              </div>
            </div>
          )}
        </div>

        {/* Popped out, neither column is drawn here: it lives in the other
            window, which shows the same message for a pathless PDF. */}
        {!notesDetached && pdf && !openPath && (
          // A PDF opened from bytes (a drag from a browser, say) has no path to
          // store strips against, so the column explains itself instead of the
          // toggle appearing to do nothing.
          <aside
            ref={notesPaneRef}
            className={`doc-notes${notesPanelOpen ? " is-open" : ""}`}
            style={{ width: notesPanelWidth }}
            aria-label="Notes of this PDF"
          >
            <header className="notes-head">
              <span className="notes-head-title">Notes of this PDF</span>
            </header>
            <p className="notes-message">{PATHLESS_NOTES_MESSAGE}</p>
          </aside>
        )}

        {!notesDetached && pdf && openPath && (
          <DocumentNotesPanel
            paneRef={notesPaneRef}
            width={notesPanelWidth}
            onResizeStart={onNotesPanelResize}
            open={notesPanelOpen}
            filePath={openPath}
            documentName={pdf?.sourceName ?? APP_TITLE}
            pageCount={pdf?.pages.length}
            onOpenStrip={parkSavedStrip}
            onStatus={setSavedToast}
            pendingEditId={pendingNoteEditId}
            onPendingEditHandled={() => setPendingNoteEditId(null)}
            revealId={revealStripId}
            onRevealHandled={clearReveal}
            // No bridge in the plain web build, so no pop-out there: a second
            // window would have nothing to talk to.
            onDetach={isTauri() ? () => void detachNotes() : undefined}
          />
        )}
      </div>

      </div>

      {view === "notes" && (
        <NotesView
          onOpenStrip={(document, strip) => void openStripFromNotes(document, strip)}
          onStatus={setSavedToast}
          pendingEditId={pendingNoteEditId}
          onPendingEditHandled={() => setPendingNoteEditId(null)}
        />
      )}

      {savedToast && (
        <div className="save-toast" role="status">
          {savedToast}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          void onHtmlFile(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}

export default App;
