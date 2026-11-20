import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
} from "react";
import "./App.css";
import { BackendStatusBar } from "./components/BackendStatusBar";
import { TitleBar, type AppTab } from "./components/TitleBar";
import { NotesView } from "./components/NotesView";
import { DocumentNotesPanel } from "./components/DocumentNotesPanel";
import { ListTree, StickyNote } from "lucide-react";
import {
  DEFAULT_NOTES_PANEL,
  MAX_NOTES_PANEL,
  MIN_NOTES_PANEL,
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
import { dismissesStrip } from "./stripDismiss";
import { panelShortcut } from "./shortcuts";
import { findHits, type SearchBox, type SearchHit } from "./search";
import {
  dropRecent,
  filePathFromFile,
  loadPrefs,
  rememberPage,
  rememberRecent,
  savePrefs,
  type RecentDoc,
  type StripLock,
} from "./prefs";
import { installAppMenu, setDocumentMenuName } from "./appMenu";
import type { FocusableStrip, PdfDocumentListItem } from "./types/dto";
import { apiErrorMessage } from "./store/api/baseApi";
import { focusableStripApi } from "./store/api/focusableStripApi";
import { pdfDocumentApi } from "./store/api/pdfDocumentApi";
import { appStateApi } from "./store/api/appStateApi";
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

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isPdfFile(file: File): boolean {
  if (file.type === "application/pdf") return true;
  return file.name.toLowerCase().endsWith(".pdf");
}

function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
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
  const parkedCenterYRef = useRef<number | null>(null);
  const contentLockRef = useRef<ContentLock | null>(null);
  const dragLockRef = useRef<DragLock | null>(null);
  const pdfRef = useRef<LoadedPdf | null>(null);
  const zoomRef = useRef(1);
  const stripHeightRef = useRef(DEFAULT_STRIP);
  const stripBlurRef = useRef(DEFAULT_BLUR);
  const stripLockRef = useRef<StripLock>(initialPrefs.stripLock);
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
  const pendingPageRestore = useRef<number | null>(null);
  /** Page point a just-opened saved strip wants on the band line, if any. */
  const pendingStripRestore = useRef<{ fracY: number } | null>(null);
  const skipRestoreUntilZoom = useRef(false);
  const openSearchRef = useRef<() => void>(() => { });
  const stepHitRef = useRef<(delta: number) => void>(() => { });
  const openWithPickerRef = useRef<() => void>(() => { });
  const nudgeFocusStripRef = useRef<(deltaY: number) => void>(() => { });

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
  const [stripLock, setStripLockState] = useState<StripLock>(() => initialPrefs.stripLock);
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
  const [createStrip] = focusableStripApi.endpoints.createStrip.useMutation();
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

  /** Switch between the PDF viewer and the Notes browser. */
  const switchView = useCallback((next: AppTab) => {
    setView(next);
  }, []);

  const renderZoom = useDebouncedValue(zoom, 140);
  const thumbWidth = Math.max(72, railWidth - RAIL_CHROME);

  zoomRef.current = zoom;
  stripHeightRef.current = stripHeight;
  stripBlurRef.current = stripBlur;
  stripLockRef.current = stripLock;
  recentsRef.current = recents;
  currentPageRef.current = currentPage;
  focusModeRef.current = focusMode;
  remarkedStripsRef.current = remarked;

  useEffect(() => {
    savePrefs({ stripBase: stripHeight, stripBlur, stripLock, recents });
  }, [stripHeight, stripBlur, stripLock, recents]);

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
        stripLock: stripLockRef.current,
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
        const stageY =
          stripLockRef.current === "scroll" && contentLockRef.current
            ? stageYFromContentLock(stage, scrollerRef.current, contentLockRef.current)
            ?? parkedCenterYRef.current
            ?? y - rect.top
            : parkedCenterYRef.current ?? y - rect.top;
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
    const rect = page.getBoundingClientRect();
    scroller.scrollLeft += rect.left + rect.width * anchor.fracX - anchor.clientX;
    scroller.scrollTop += rect.top + rect.height * anchor.fracY - anchor.clientY;
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

  const openWithPicker = useCallback(async () => {
    try {
      if (isTauri()) {
        const selected = await open({
          multiple: false,
          title: "Open PDF",
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (!selected || Array.isArray(selected)) return;
        await openFromPath(selected);
        return;
      }
      fileInputRef.current?.click();
    } catch (cause) {
      console.error(cause);
      setError(cause instanceof Error ? cause.message : "File dialog failed.");
    }
  }, [openFromPath]);

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

  const setStripLock = useCallback((next: StripLock) => {
    const stage = stageRef.current;
    const stageRect = stage?.getBoundingClientRect();
    if (stage && stageRect) {
      const visualY =
        stripLockRef.current === "scroll" && contentLockRef.current
          ? stageYFromContentLock(stage, scrollerRef.current, contentLockRef.current)
          : parkedCenterYRef.current;
      const centerY = visualY ?? parkedCenterYRef.current ?? stageRect.height / 2;
      parkedCenterYRef.current = centerY;
      if (next === "scroll") {
        const clientX = cursorRef.current?.x ?? stageRect.left + stageRect.width / 2;
        contentLockRef.current =
          contentLockAtPoint(scrollerRef.current, clientX, stageRect.top + centerY)
          ?? contentLockRef.current;
      }
    }
    setStripLockState(next);
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
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = pane.getBoundingClientRect().width;

    const onMove = (move: PointerEvent) => {
      setRailWidth(clamp(startWidth + (move.clientX - startX), MIN_RAIL, MAX_RAIL));
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
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

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const updateStageSize = () =>
      setStageSize((current) =>
        current.width === stage.clientWidth && current.height === stage.clientHeight
          ? current
          : { width: stage.clientWidth, height: stage.clientHeight },
      );
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
        setNotesPanelOpen((open) => !open);
        return;
      }
      if (meta && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        openSearch();
        return;
      }
      if (searchOpen && event.key === "Escape") {
        event.preventDefault();
        closeSearch();
        return;
      }
      if (focusMode && event.key === "Escape") {
        event.preventDefault();
        setFocusMode(false);
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
    void openFromPath(last.path, last.name);
  }, [openFromPath, recents]);

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
    const stageRect = stage.getBoundingClientRect();
    const height = stripScreenPx(stripHeightRef.current, zoomRef.current);
    let centerY = parkedCenterYRef.current ?? stageRect.height / 2;
    if (stripLockRef.current === "scroll" && contentLockRef.current) {
      centerY =
        stageYFromContentLock(stage, scrollerRef.current, contentLockRef.current) ?? centerY;
    }
    overlay.style.setProperty("--hole-top", `${centerY - height / 2}px`);
    overlay.style.setProperty("--hole-height", `${height}px`);
  }, []);

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
      const placement = placeStripPoint({
        stageHeight: stageRect.height,
        lineFraction: STRIP_LINE_FRACTION,
        pageTop: pageRect.top - stageRect.top,
        pageHeight: pageRect.height,
        fracY,
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
      if (stripLockRef.current === "scroll" && contentLockRef.current) {
        current =
          stageYFromContentLock(stage, scrollerRef.current, contentLockRef.current) ?? current;
      }
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

  // Middle-button drag pans the document vertically. The scroll is a plain
  // scrollTop write, so the scroll spy and the strip's scroll re-layout both
  // pick it up exactly as they do for a wheel scroll.
  const onStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 1 || !pdf) return;
    const scroller = scrollerRef.current;
    const stage = stageRef.current;
    if (!scroller || !stage) return;
    event.preventDefault();
    stage.setPointerCapture(event.pointerId);
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
    };
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
  };

  const onStripDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(".focus-edge")) return;
    const overlay = focusOverlayRef.current;
    const stage = stageRef.current;
    if (!overlay || !stage) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("dragging");

    const startTop = Number.parseFloat(overlay.style.getPropertyValue("--hole-top")) || 0;
    const holeHeight =
      Number.parseFloat(overlay.style.getPropertyValue("--hole-height")) ||
      stripScreenPx(stripHeightRef.current, zoomRef.current);
    const startPointerY = event.clientY;
    dragLockRef.current = { holeTop: startTop, holeHeight };

    const onMove = (move: PointerEvent) => {
      const nextTop = startTop + (move.clientY - startPointerY);
      dragLockRef.current = { holeTop: nextTop, holeHeight };
      cursorRef.current = { x: move.clientX, y: move.clientY };
      layoutOverlays();
    };
    const onUp = (up: PointerEvent) => {
      const lock = dragLockRef.current;
      const nextCenter = (lock?.holeTop ?? startTop) + holeHeight / 2;
      const stageRect = stage.getBoundingClientRect();
      commitStripCenter(up.clientX, stageRect.top + nextCenter, nextCenter);
      dragLockRef.current = null;
      handle.classList.remove("dragging");
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      layoutOverlays();
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const onEdgeResize = (edge: "top" | "bottom") => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
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
    const startPointerY = event.clientY;
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

    const onMove = (move: PointerEvent) => applyHole(move.clientX, move.clientY, false);
    const onUp = (up: PointerEvent) => {
      applyHole(up.clientX, up.clientY, true);
      dragLockRef.current = null;
      handle.classList.remove("dragging");
      overlay.classList.remove("resizing");
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      layoutOverlays();
    };
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
      setFocusMode(true);
      layoutOverlays();
      requestAnimationFrame(layoutOverlays);
      return true;
    },
    [commitStripCenter, layoutOverlays, setStripHeight],
  );

  /**
   * Open a saved strip from the Notes tab.
   *
   * Park the display strip on a saved strip, in the document that is already
   * open. Shared by the Notes tab (after it has opened the document) and the
   * docked panel (where it always is).
   */
  const parkSavedStrip = useCallback((strip: FocusableStrip) => {
    const pageHeight = strip.page_height > 0 ? strip.page_height : 1;
    const fracY = (strip.top + strip.height / 2) / pageHeight;
    contentLockRef.current = { page: strip.page_number, fracY };
    // The band has no screen position until the page is measured, which is what
    // the restore below does; until then it would draw in the old place.
    parkedCenterYRef.current = null;
    setStripHeight(clamp(strip.height, MIN_STRIP, MAX_STRIP));
    setFocusMode(true);
    pendingStripRestore.current = { fracY };
    pendingPageRestore.current = strip.page_number;
    setRestoreTick((tick) => tick + 1);
  }, []);

  /**
   * Show the remark a badge is announcing.
   *
   * The notes column opens on that strip's card: `StripList` owns the rest of it
   * — opening the card's folder, selecting it, and putting it on the column's
   * reading line — because it owns the list. The band and the page are left
   * alone: the badge is a note about a passage, not a request to scroll to it.
   */
  const openRemark = useCallback((strip: FocusableStrip) => {
    setNotesPanelOpen(true);
    setRevealStripId(strip.id);
  }, []);

  /** The column has found and placed the card the badge asked for. */
  const clearReveal = useCallback(() => setRevealStripId(null), []);

  const openStripFromNotes = useCallback(
    async (document: PdfDocumentListItem, strip: FocusableStrip) => {
      switchView("pdf");

      const alreadyOpen = openDocRef.current?.path === document.file_path;
      if (!alreadyOpen) {
        await openFromPath(document.file_path, document.name);
        if (openDocRef.current?.path !== document.file_path) {
          // The file moved or was deleted; `openFromPath` already said so.
          switchView("notes");
          return;
        }
      }

      parkSavedStrip(strip);
    },
    [openFromPath, parkSavedStrip],
  );

  /**
   * Save the display strip, then hand the note over to its card.
   *
   * No dialog: the row is written immediately, the "Notes of this PDF" column
   * opens, and the new card's remark field takes focus. Cancelling the note
   * therefore leaves a saved strip with no note, which is a valid state.
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
      const document = await resolveDocument({
        file_path: open.path,
        name: open.name,
        page_count: loaded.pages.length,
        fingerprint: loaded.document.fingerprints[0] ?? undefined,
      }).unwrap();

      const geometry = savedStripGeometry(page, lock.fracY * page.height, stripHeightRef.current);
      // The API takes an optional string, so "no text under the strip" is an
      // absent field rather than an explicit null.
      const { text_excerpt, ...rest } = geometry;
      const saved = await createStrip({
        pdf_document_id: document.id,
        ...rest,
        ...(text_excerpt === null ? {} : { text_excerpt }),
      }).unwrap();

      setStripSaveState("saved");
      setStripSaveMessage(`Saved page ${geometry.page_number}.`);
      // Open the column and let the new card's field take the caret.
      setNotesPanelOpen(true);
      setPendingNoteEditId(saved.id);
    } catch (cause) {
      setStripSaveState("error");
      setStripSaveMessage(apiErrorMessage(cause) ?? "Could not save the strip.");
    }
  }, [createStrip, resolveDocument]);

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

  /**
   * Whether the **Notes of this PDF** column was open when the current press
   * began.
   *
   * The column's own dismissal runs on the press, so by the time the `click`
   * that completes the same gesture arrives, `notesPanelOpen` is already false —
   * and this effect has re-registered the strip's handler with that value. A
   * live read would therefore see the column as gone and dismiss the strip
   * anyway, which is exactly the double dismissal this is here to prevent.
   * Recording the state at press time is what the click needs to know instead;
   * refreshed on every press, so it can never describe an older gesture.
   */
  const notesPanelOpenAtPress = useRef(false);
  useEffect(() => {
    const onPointerDown = () => {
      notesPanelOpenAtPress.current = notesPanelOpen;
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [notesPanelOpen]);

  /**
   * A left click anywhere outside the band turns the strip off — unless the
   * **Notes of this PDF** column is in the way, in which case that click closes
   * the column (its effect is below) and the strip stays up. The column is a
   * layer above the page with its own outside-click dismissal, so it owns the
   * gesture: one click, one dismissal, and picking a card or putting the caret in
   * a freshly saved strip's note field does not end the reading session.
   *
   * Focus mode covers the page with a veil, so a click outside the reading hole
   * is the natural way to leave it — for a strip double-clicked up, toggled with
   * `F`, or opened from a saved card alike.
   *
   * `click`, not `pointerdown`: a press that becomes a drag never fires a click,
   * so dragging the scrollbar (the strip rides the page in Scroll lock) or
   * selecting a sentence leaves the strip up. The second click of a double-click
   * is excluded in `dismissesStrip`, which is what keeps a double-click elsewhere
   * a *move* — the first click clears the old strip, the second parks the new one
   * around the paragraph that was hit. The band, its menu, the toolbar and the
   * note dialog are exempt; `stripDismiss` holds the list and the reasoning.
   */
  useEffect(() => {
    if (!focusMode) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // Open now, or open when this press began (in which case it may have just
      // closed on that press): either way the click is the column's.
      const notesPanelTakesClick = notesPanelOpen || notesPanelOpenAtPress.current;
      if (
        dismissesStrip(
          { button: event.button, clickCount: event.detail, target },
          { notesPanelOpen: notesPanelTakesClick },
        )
      ) {
        setFocusMode(false);
      }
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [focusMode, notesPanelOpen]);

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
        if (path) void openFromPath(path);
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
  }, [openFromPath]);

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
    stripLock,
    zoom,
  ]);

  /* And everything the scroll decides. The band has to follow the page in Scroll
     lock (in Fixed lock it stays put), while the badges are pinned to their pages,
     so they are laid out on every scroll — as long as the document has any. */
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

  // The column width is remembered in the backend rather than in the webview's
  // storage, so it follows the profile; a missing or unreadable value just keeps
  // the default. Applied once, so a later invalidation cannot fight a drag.
  useEffect(() => {
    if (notesPanelWidthLoaded.current || !appState) return;
    notesPanelWidthLoaded.current = true;
    const stored = Number(appState[NOTES_PANEL_WIDTH_KEY]);
    if (Number.isFinite(stored) && stored > 0) {
      setNotesPanelWidth(clamp(stored, MIN_NOTES_PANEL, MAX_NOTES_PANEL));
    }
  }, [appState]);

  /**
   * Clicking anywhere outside the column dismisses it.
   *
   * `pointerdown` rather than `click`, so the dismissal happens on the press: the
   * click that follows (selecting text in the page, parking a strip) then lands on
   * a page that is no longer covered by the column, instead of half-way through
   * the slide-out.
   *
   * That press is also what keeps the click from reaching the reading strip: it
   * closes the column instead, and `notesPanelOpenAtPress` tells the strip's
   * handler that this gesture was already spent (see the two effects above).
   *
   * The panel's own subtree is exempt, which covers the strip cards, the inline
   * editor, the card menu and the markdown popup. The toolbar toggle is exempt too:
   * it toggles on its own click, and closing here as well would fight it.
   */
  useEffect(() => {
    if (!notesPanelOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // The card menu and the markdown popup are portalled to `document.body` so
      // the column's transform cannot clip them, which puts them outside the
      // column in the DOM as well: they count as inside for this dismissal. The
      // band's note badge is outside too, and it is asking for the column rather
      // than dismissing it.
      if (
        target?.closest(".doc-notes, .notes-toggle, .strip-menu, .note-backdrop, .remark-marker")
      ) {
        return;
      }
      setNotesPanelOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [notesPanelOpen]);

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
    const startX = event.clientX;
    const startWidth = pane.getBoundingClientRect().width;
    let width = startWidth;

    const onMove = (move: PointerEvent) => {
      // Dragging left widens this column, because it hangs off the right edge.
      // The floor is 0, not the minimum: dragging all the way in is how the
      // column is closed, and it should follow the pointer while it happens.
      width = clamp(startWidth + (startX - move.clientX), 0, MAX_NOTES_PANEL);
      if (width >= MIN_NOTES_PANEL) lastNotesPanelWidthRef.current = width;
      setNotesPanelWidth(width);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      if (Math.abs(width - startWidth) < 1) return;

      const settled = resolveNotesPanelDrag(width);
      if (settled.kind === "close") {
        // Dragged shut: close the column, and put the width back so reopening it
        // from the toolbar brings it back at a usable size.
        setNotesPanelWidth(restoredNotesPanelWidth(lastNotesPanelWidthRef.current));
        setNotesPanelOpen(false);
        return;
      }

      setNotesPanelWidth(settled.width);
      lastNotesPanelWidthRef.current = settled.width;
      // Fire and forget: forgetting the width only means the next launch starts
      // at the default.
      void putAppState({ key: NOTES_PANEL_WIDTH_KEY, value: String(settled.width) });
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
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
                void openFromPath(path);
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
          <div className="lock-toggle" role="group" aria-label="Focus strip lock">
            <button
              className={stripLock === "scroll" ? "ghost active" : "ghost"}
              onClick={() => setStripLock("scroll")}
              aria-pressed={stripLock === "scroll"}
              disabled={!pdf}
              title="Strip rides the page as you scroll"
            >
              Scroll
            </button>
            <button
              className={stripLock === "fixed" ? "ghost active" : "ghost"}
              onClick={() => setStripLock("fixed")}
              aria-pressed={stripLock === "fixed"}
              disabled={!pdf}
              title="Strip stays at a fixed screen height"
            >
              Fixed
            </button>
          </div>
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
          <button className="icon" onClick={() => bumpZoom(1 / ZOOM_STEP)} disabled={!pdf} aria-label="Zoom out">
            −
          </button>
          <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
          <button className="icon" onClick={() => bumpZoom(ZOOM_STEP)} disabled={!pdf} aria-label="Zoom in">
            +
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
            zoom/find cluster. */}
        <button
          className={`ghost notes-toggle${notesPanelOpen ? " active" : ""}`}
          onClick={() => setNotesPanelOpen((open) => !open)}
          aria-pressed={notesPanelOpen}
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
                    it as a record for this document. By default the strip rides
                    the page as you scroll; switch to Fixed to keep a screen-height
                    window. Everything else sits under a 70% veil.
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
                          onClick={() => doc.path && void openFromPath(doc.path, doc.name)}
                        >
                          <span title={doc.name}>{doc.name}</span>
                          {doc.path && <em title={doc.path}>{doc.path}</em>}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="hints">
                    <div>Drop a file here · <kbd>⌘</kbd><kbd>O</kbd> to open</div>
                    <div>Double-click a paragraph to focus · right-click the band to save it · drag the band · middle-drag to pan · Scroll / Fixed lock · drag a border to resize · click outside to clear · <kbd>F</kbd> toggle · <kbd>T</kbd> pages</div>
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
                  title={`Page ${strip.page_number} — ${noteSummary(strip.remark, 140)}\nClick to show it in Notes of this PDF.`}
                  aria-label={`Remark on page ${strip.page_number}: ${noteSummary(strip.remark, 60)}. Show it in Notes of this PDF.`}
                  onClick={() => openRemark(strip)}
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
              style={{ ["--focus-strip-blur" as string]: `${stripBlur}px` }}
            >
              <div className="focus-mask" aria-hidden />
              <div
                className="focus-band"
                onPointerDown={onStripDrag}
                onContextMenu={onStripContextMenu}
                role="separator"
                aria-orientation="horizontal"
                aria-label="Move reading strip"
              >
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
                {stripSaveState === "saving" ? "Saving..." : "Save strip"}
              </button>
              <div
                className={`strip-menu-note${stripSaveState === "error" ? " is-error" : ""}`}
                role="status"
              >
                {stripSaveMessage ?? "Adds this strip to the open document, with an optional note."}
              </div>
            </div>
          )}
        </div>

        {pdf && !openPath && (
          // A PDF opened from bytes (a drag from a browser, say) has no path to
          // store strips against, so the column explains itself instead of the
          // toggle appearing to do nothing.
          <aside
            className={`doc-notes${notesPanelOpen ? " is-open" : ""}`}
            style={{ width: notesPanelWidth }}
            aria-label="Notes of this PDF"
          >
            <header className="notes-head">
              <span className="notes-head-title">Notes of this PDF</span>
            </header>
            <p className="notes-message">
              This PDF was opened without a file path, so its strips cannot be stored. Open it
              through <strong>Open PDF</strong> to keep notes for it.
            </p>
          </aside>
        )}

        {pdf && openPath && (
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

      <BackendStatusBar />

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
