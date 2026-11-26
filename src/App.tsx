import { getCurrentWebview } from "@tauri-apps/api/webview";
import { backendTargetFromDevEnv, getBackendTarget } from "./backendConfig";
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
  useSyncExternalStore,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";
import "./App.css";
import { BackendStatusChip } from "./components/BackendStatusBar";
import { ShortcutKeys } from "./components/ShortcutKeys";
import { TitleBar, type AppTab } from "./components/TitleBar";
import { DashboardView } from "./components/DashboardView";
import { DocumentNotesPanel } from "./components/DocumentNotesPanel";
import { PdfPagePen } from "./components/PdfPagePen";
import { PageLayoutMenu } from "./components/PageLayoutMenu";
import { HighlightContextMenu } from "./components/HighlightContextMenu";
import { PageContextMenu } from "./components/PageContextMenu";
import { ContextMenuSeparator } from "./components/ContextMenu";
import { EventLogPanel } from "./components/EventLogPanel";
import { ChevronLeft, ChevronRight, ListTree, Minus, Plus, StickyNote, Workflow } from "lucide-react";
import {
  DEFAULT_NOTES_PANEL,
  MIN_NOTES_PANEL,
  maxNotesPanelWidth,
  PATHLESS_NOTES_MESSAGE,
  resolveNotesPanelDrag,
  restoredNotesPanelWidth,
} from "./notesPanel";
import {
  DEFAULT_EVENT_LOG_PANEL,
  MIN_EVENT_LOG_PANEL,
  maxEventLogPanelWidth,
  resolveEventLogPanelDrag,
  restoredEventLogPanelWidth,
} from "./eventLogPanel";
import {
  fileNameFromPath,
  loadPdfFromBytes,
  renderPageToCanvas,
  renderPageTextLayer,
  type LoadedPage,
  type LoadedPdf,
} from "./pdf";
import { findParagraphAt, paragraphBoxesFromTextLayer } from "./paragraph";
import {
  dragTypesIncludeFiles,
  isPdfFile,
  pdfPaths,
  showPdfDropVeil,
} from "./pdfDrop";
import { placeStripPoint, STRIP_LINE_FRACTION } from "./stripLine";
import { stripSelectBand } from "./stripSelect";
import { panelShortcut, scrollHistoryShortcut } from "./shortcuts";
import { zoomForArea } from "./zoomProportion";
import { zoomAnchorInArea } from "./zoomAnchor";
import {
  fitZoom,
  pageHoleSpan,
  pairPages,
  sameSpread,
  spreadEnd,
  spreadStart,
  SPREAD_GAP_PX,
  type PageLayout,
} from "./pageLayout";
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
  pageLayoutToSave,
  rememberPage,
  rememberRecent,
  savePrefs,
  type RecentDoc,
} from "./prefs";
import { installAppMenu, setDocumentMenuName } from "./appMenu";
import { IS_WINDOWS, PLATFORM } from "./platform";
import { SHORTCUT } from "./shortcutHints";
import { useHistoryShortcuts } from "./useHistoryShortcuts";
import { deletedOpenDocument } from "./deletedOpenDocument";
import type {
  Note,
  NoteWithDocument,
  PdfDocumentListItem,
  PdfDocumentWithNotes,
} from "./types/dto";
import { apiErrorMessage } from "./store/api/baseApi";
import { noteApi } from "./store/api/noteApi";
import { pdfDocumentApi } from "./store/api/pdfDocumentApi";
import { appStateApi } from "./store/api/appStateApi";
import { invalidateEveryTag } from "./store/cacheStale";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { store } from "./store/store";
import {
  activePdfScrollOffset,
  clearPdfScrollPositions,
  goToNextPdfScroll,
  goToPreviousPdfScroll,
  recordPdfScrollPosition,
  settleActivePdfScroll,
} from "./store/slices/appSlice";
import { loadNotesWindowRect } from "./notesWindowGeometry";
import { parseViewerRequest } from "./viewerRequest";
import {
  NotesEvent,
  currentLabel,
  emitToNotes,
  getNotesWindow,
  isTauri,
  openNotesWindow,
  openAppWindow,
  openDocumentViewerWindow,
  openReferenceViewerWindow,
  subscribe,
  type CacheStalePayload,
  type NotesContext,
  type OpenStripRequest,
} from "./windowBridge";
import { savedStripGeometry } from "./stripAnchor";
import { brushUnderPoint } from "./textBrush";
import { installPointerSpot, pointerSpot } from "./pointerSpot";
import { readingHoleTakesContextMenu } from "./stripMenuHit";
import { noteSummary } from "./notesText";
import { copyTextToClipboard } from "./clipboard";
import { noteReferenceMarkdown } from "./noteReference";
import {
  DEFAULT_BRUSH_PT,
  MARK_HIT_SLACK_PX,
  MAX_BRUSH_PT,
  MIN_BRUSH_PT,
  highlightSessionId,
  highlightSessionKey,
  markAtPoint,
  parseDocumentHighlights,
  releaseHighlightSession,
  serializeDocumentHighlights,
  setBrushSize,
  subscribeHighlightSession,
  setHighlightSession,
  type DocumentHighlight,
  type StripHighlight,
} from "./stripHighlight";
import { bindPageHighlightDraft } from "./pageHighlightDraft";
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

const MIN_RAIL = 132;
const MAX_RAIL = 360;
const DEFAULT_RAIL = 176;
// Rail chrome around a thumbnail: 12px pane padding each side plus the 6px
// padding the .thumb highlight needs, leaving a little slack.
const RAIL_CHROME = 40;
const STRIP_STEP = 12;
/**
 * How much wider a double-click opens the band than the paragraph's own box, in
 * points: three quarters of a `]` step — a hair of air above and below. The tight
 * box and the two-press band were both measured wrong by eye; this is the middle
 * the two agreed on. Nudging it open was the first thing a reader did, so the
 * opening is built in.
 */
const DOUBLE_CLICK_SLACK = STRIP_STEP * 0.75;
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
/**
 * How long the PDF scroller has to sit still before its vertical offset is
 * remembered. A wheel flick, a scrollbar drag and a jump to a page all move
 * `scrollTop` many times; one mark per resting place is the history worth keeping.
 */
const PDF_SCROLL_RECORD_MS = 300;
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

const PDF_PEN_SESSION = 0;

const PdfPageView = memo(function PdfPageView({
  page,
  renderZoom,
  hits,
  activeHit,
  marks = [],
  highlighting = false,
  onStroke,
  onMarkContextMenu,
}: {
  page: LoadedPage;
  renderZoom: number;
  hits: Array<{ index: number; boxes: SearchBox[] }>;
  activeHit: number;
  /** This page's marks, in PDF points. They belong to the document. */
  marks?: readonly StripHighlight[];
  /** The toolbar pen is down, so a drag on this page lays a stroke. */
  highlighting?: boolean;
  onStroke?: (mark: StripHighlight) => void;
  /** Open this stroke's menu at the pointer. The pen is what offers it. */
  onMarkContextMenu?: (mark: StripHighlight, x: number, y: number) => void;
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
      { rootMargin: "1400px 800px" },
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

  const highlightMarks = useMemo(() => {
    return marks.flatMap((mark, index) => {
      const width = Math.abs(mark.x1 - mark.x0);
      if (width < 0.5) return [];
      return [{
        key: `${page.index}-${index}`,
        x: Math.min(mark.x0, mark.x1),
        y: mark.y,
        w: width,
        h: mark.size,
      }];
    });
  }, [marks, page.index]);

  /**
   * The saved mark under the pointer, as an index into `marks`.
   *
   * The marks themselves take no pointer — the words under them stay selectable
   * — so a right-click is matched against them by hit test instead: the pointer's
   * place is put back into PDF points through the page's current box, the space
   * the marks live in. The slack is a length on screen, so a stroke's edge is as
   * forgiving at 400% as at 100%.
   */
  const markUnderPointer = (clientX: number, clientY: number): number | null => {
    const host = wrapRef.current;
    if (!host || marks.length === 0) return null;
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const scale = rect.width / (page.width > 0 ? page.width : 1);
    return markAtPoint(
      marks,
      { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale },
      MARK_HIT_SLACK_PX / scale,
    );
  };

  /**
   * Right-clicking a stroke is how one is removed.
   *
   * The stroke's whole length is the target, so there is no control to aim at on
   * the page. It is the pen's menu: with the pen put down a right-click keeps its
   * reading meaning (the strip's own menu in focus mode), and no delete path is
   * invented on the page while reading.
   */
  const onPageContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!highlighting || !onMarkContextMenu) return;
    const index = markUnderPointer(event.clientX, event.clientY);
    if (index == null) return;
    const mark = marks[index];
    if (!mark) return;
    // The menu is what answered this press; the stage's own right-click must not
    // open the strip's menu behind it as well.
    event.preventDefault();
    event.stopPropagation();
    onMarkContextMenu(mark, event.clientX, event.clientY);
  };

  return (
    <div
      ref={wrapRef}
      className="page-shell"
      data-page={page.index}
      onContextMenu={onPageContextMenu}
      style={{
        /* Sizes live in CSS as `calc(var(--page-w) * var(--zoom))`, so a zoom
           tick only rewrites one custom property on the column instead of
           re-rendering every page in the document. */
        ["--page-w" as string]: String(page.width),
        ["--page-h" as string]: String(page.height),
      }}
    >
      <canvas ref={canvasRef} />
      {/* One multiply group for every mark on this page, saved or still being
          drawn. The shapes are one yellow, so a crossing stays that yellow, and
          the group multiplies it into the paper. The same list is what the
          note preview paints. */}
      <div className="page-highlights" aria-hidden>
        {highlightMarks.map((mark) => (
          <div
            key={mark.key}
            className="page-highlight"
            style={{
              ["--hit-x" as string]: String(mark.x),
              ["--hit-y" as string]: String(mark.y),
              ["--hit-w" as string]: String(mark.w),
              ["--hit-h" as string]: String(mark.h),
            }}
          />
        ))}
        <div
          className="page-highlight"
          ref={(node) => bindPageHighlightDraft(page.index, node)}
          hidden
        />
      </div>
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
      {highlighting && onStroke && (
        <PdfPagePen pageWidth={page.width} pageHeight={page.height} onStroke={onStroke} />
      )}
      <span className="page-index">{page.index}</span>
    </div>
  );
});

const ThumbnailView = memo(function ThumbnailView({
  page,
  active,
  lead = false,
  width,
  onSelect,
}: {
  page: LoadedPage;
  active: boolean;
  /** The page the counter names. Only this thumb scrolls the rail. */
  lead?: boolean;
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
    if (!lead) return;
    buttonRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [lead]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={active ? "thumb active" : "thumb"}
      onClick={() => onSelect(page.index)}
      aria-current={lead ? "page" : undefined}
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
  /**
   * Set when the next zoom change is the viewer's answer to a column opening or
   * closing, not the reader's own zoom. Only that change has to repaint the
   * scroller afterwards; see the correction effect.
   */
  const layoutZoomRef = useRef(false);
  const railPaneRef = useRef<HTMLElement>(null);
  const restoredLast = useRef(false);
  const recentsRef = useRef(initialPrefs.recents);
  const currentPageRef = useRef(1);
  const pageLayoutRef = useRef<PageLayout>(initialPrefs.pageLayout);
  /**
   * Where the page the reader is on sat, measured before a layout change.
   * The next paint puts that page back, so switching Single / Two Pages does
   * not jump them to the top of the document or change the zoom.
   */
  const layoutAnchorRef = useRef<{ page: number; top: number; left: number } | null>(null);
  const openDocRef = useRef<{ name: string; path?: string } | null>(null);
  /** Bumped on every open, so a slower import cannot paint over a newer one. */
  const openSeqRef = useRef(0);
  /** Focus mode as the overlay's layout sees it; that runs outside React's render. */
  const focusModeRef = useRef(false);
  /** The strips wearing a note badge, in draw order; see `layoutRemarkMarkers`. */
  const remarkedStripsRef = useRef<Note[]>([]);
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
  const openAppWindowRef = useRef<() => void>(() => { });
  const nudgeFocusStripRef = useRef<(deltaY: number) => void>(() => { });
  /** Debounce handle for {@link recordPdfScrollPosition}. Cleared on document change. */
  const pdfScrollRecordTimer = useRef(0);
  /**
   * Set while a zoom correction rewrites `scrollTop` to hold the anchor. That
   * rewrite is not a new place in the document, so the scroll listener skips it.
   */
  const pdfScrollRecordSuspended = useRef(false);
  const pdfScrollSuspendRelease = useRef(0);

  /** Needed to hand the other window's invalidations to this window's cache. */
  const dispatch = useAppDispatch();
  const canGoToPreviousScroll = useAppSelector((state) => state.app.pdfScrollIndex > 0);
  const canGoToNextScroll = useAppSelector((state) => {
    const index = state.app.pdfScrollIndex;
    return index >= 0 && index < state.app.pdfScrollPositions.length - 1;
  });

  /**
   * What this window was opened for, when it is a window of its own.
   *
   * A `[note:<id>]` reference opens one of these instead of moving the window the
   * reader is in: a viewer of its own on the note's document, in single page
   * mode, with the reading strip parked on the note's band and the notes column
   * closed. The request is in this window's query string, so it is read once and
   * never changes; a window that is not one of these has `null` and behaves
   * exactly as the main window always has.
   *
   * A window opened on a document alone — the documents column's "Open PDF in new
   * window" — arrives the same way, with no note. It is this app's viewer with
   * nothing to park, so it reads as a window of its own rather than as a look at
   * a passage: the rail is where the main window leaves it, the notes column
   * starts folded, and the app menu is installed as it is in every full window.
   */
  const [viewerRequest] = useState(() => parseViewerRequest());
  /** Opened as a window of its own, on a note or on a whole document. */
  const isViewerWindow = viewerRequest !== null;
  /** Opened on one passage: there is a note to put the reading strip on. */
  const isReferenceViewer = viewerRequest?.noteId != null;

  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [zoom, setZoom] = useState(1);
  const [focusMode, setFocusMode] = useState(false);
  /** The toolbar pen. While it is down, a drag on any page of the open PDF lays a stroke. */
  const [highlightMode, setHighlightMode] = useState(false);
  const [highlightBrush, setHighlightBrush] = useState(DEFAULT_BRUSH_PT);
  const armedPenId = useSyncExternalStore(
    subscribeHighlightSession,
    highlightSessionId,
    highlightSessionId,
  );
  const pdfPenBlocked = armedPenId !== null && armedPenId !== PDF_PEN_SESSION;
  /**
   * The pages rail, open by default — except in a reference viewer.
   *
   * That window was opened for one passage: its page and its note. The rail's
   * job is getting somewhere else, which is the one thing this window is not for,
   * so it arrives folded to its label and is one click (or ⌘B) away when the
   * reader does want to move.
   */
  const [showThumbs, setShowThumbs] = useState(!isReferenceViewer);
  const [pageLayout, setPageLayout] = useState<PageLayout>(
    isReferenceViewer ? "single" : initialPrefs.pageLayout,
  );
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
   * overlay draws; `saved strip` is the `note` row it becomes.
   */
  const stripMenuRef = useRef<HTMLDivElement | null>(null);
  /**
   * `brushPt` is the brush the text under the press asked for when the menu
   * opened, or null when the press was not over page text. It is read at the
   * right-click rather than at the item's click: the pointer has moved to the
   * menu by then, and the text the press landed on is what is being marked.
   */
  const [stripMenu, setStripMenu] = useState<{
    x: number;
    y: number;
    brushPt: number | null;
  } | null>(null);
  /**
   * The page's menu, for a right-click that did not land in the reading strip:
   * the same pen toggle the strip's menu carries.
   */
  const [pageMenu, setPageMenu] = useState<{
    x: number;
    y: number;
    brushPt: number | null;
  } | null>(null);
  /**
   * The right-click menu of one saved highlight: which page, which stroke, and
   * where the pointer was. It belongs to the pen, so it is only ever opened from
   * a page that has its pen armed.
   */
  const [highlightMenu, setHighlightMenu] = useState<{
    page: number;
    mark: StripHighlight;
    x: number;
    y: number;
  } | null>(null);
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
  /**
   * A PDF is being dragged over the window. The veil that follows covers the
   * whole application: the title strip, the toolbar, the page and the notes,
   * because a drop lands wherever it is released.
   */
  const [pdfDropActive, setPdfDropActive] = useState(false);
  /** Which of the two top-level views is showing. */
  const [view, setView] = useState<AppTab>("pdf");
  /**
   * The docked event log: what the backend recorded, watched beside the page.
   *
   * A column of its own in the same row as the notes column — it takes width from
   * the page rather than covering it, so the log can be watched *while* the viewer
   * is used. It obeys the same rules (`eventLogPanel.ts`), remembers its width the
   * same way. Escape closes it only once the reading strip is off; while the
   * strip is on, that press turns the strip off and leaves the log up.
   */
  const [eventLogOpen, setEventLogOpen] = useState(false);
  const [eventLogWidth, setEventLogWidth] = useState(DEFAULT_EVENT_LOG_PANEL);
  const eventLogPaneRef = useRef<HTMLElement | null>(null);
  /** Last width that was wide enough to keep; restored when the drag closes it. */
  const lastEventLogPanelWidthRef = useRef(DEFAULT_EVENT_LOG_PANEL);
  /** The stored width is applied once; later writes must not fight the drag. */
  const eventLogPanelWidthLoaded = useRef(false);
  /** The toolbar's Events button: raise the log column, or put it away. */
  const toggleEventLog = useCallback(() => {
    setEventLogOpen((isOpen) => !isOpen);
  }, []);

  const openEventStorming = useCallback(async () => {
    const tauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (tauri) {
      try {
        const target = await getBackendTarget();
        const url = `${target.baseUrl}/event-storming/`;
        try {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(url);
        } catch {
          // The desktop opener only allows the URLs named in its capability.
          // Until that includes this address, the diagram still opens in its own window.
          const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
          const existing = await WebviewWindow.getByLabel("event-storming");
          if (existing) {
            await existing.show();
            await existing.setFocus();
            return;
          }
          new WebviewWindow("event-storming", {
            url,
            title: "Event storming",
            width: 1100,
            height: 760,
            focus: true,
          });
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not open the event-storming diagram.");
      }
      return;
    }
    // Known before the click returns, so the new window is still part of it.
    // Opening after an await is what the browser blocks, and the click then
    // looks like it did nothing.
    const known = backendTargetFromDevEnv();
    if (known) {
      window.open(`${known.baseUrl}/event-storming/`, "_blank", "noopener,noreferrer");
      return;
    }
    const popup = window.open("", "_blank");
    try {
      const target = await getBackendTarget();
      if (popup && !popup.closed) popup.location.replace(`${target.baseUrl}/event-storming/`);
    } catch (cause) {
      popup?.close();
      setError(cause instanceof Error ? cause.message : "Could not open the event-storming diagram.");
    }
  }, []);
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
  const [createStrip] = noteApi.endpoints.createStrip.useMutation();
  const [updateStrip] = noteApi.endpoints.updateStrip.useMutation();
  /** The note a reference viewer is about; skipped in every other window. */
  const { data: referenceStrip } = noteApi.endpoints.getStrip.useQuery(
    viewerRequest?.noteId ?? 0,
    { skip: !isReferenceViewer },
  );
  const { data: appState } = appStateApi.endpoints.getAppState.useQuery();
  const [updateAppState] = appStateApi.endpoints.updateAppState.useMutation();
  /**
   * The open document's saved strips, for the note badges.
   *
   * The document is found in the list the Dashboard tab already reads rather than
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
  const { data: documentHighlights = "[]" } = pdfDocumentApi.endpoints.getHighlights.useQuery(
    openDocumentId ?? 0,
    { skip: openDocumentId == null },
  );
  const [replaceDocumentHighlights] = pdfDocumentApi.endpoints.replaceHighlights.useMutation();
  const documentMarks = useMemo(
    () => parseDocumentHighlights(documentHighlights),
    [documentHighlights],
  );
  const documentMarksRef = useRef(documentMarks);
  documentMarksRef.current = documentMarks;
  const { data: savedStrips } = noteApi.endpoints.listStrips.useQuery(
    { pdf_document_id: openDocumentId ?? 0 },
    { skip: openDocumentId == null },
  );
  /** One badge per saved strip with a remark, in draw order. */
  const remarked = useMemo(() => remarkedStrips(savedStrips ?? []), [savedStrips]);
  /**
   * Whether the band's row has been seen in the strip list since the band came
   * to stand on it.
   *
   * A strip that was just saved is not in the list yet: the write has answered,
   * the invalidation's refetch has not. An absent row at that moment is a list
   * that has not caught up, not a note that was deleted, and the difference
   * decides whether the band is closed under the reader.
   */
  const displayStripSeen = useRef(false);
  useEffect(() => {
    displayStripSeen.current = false;
  }, [displayStripId]);
  /**
   * A note the band was standing on was deleted: put the band away.
   *
   * The row can be deleted from this window's column or from the popped-out one;
   * either way the strip list goes stale and refetches, and the band must not go
   * on framing a passage whose note no longer exists — it looks like the note is
   * still there. The reading strip is closed rather than left standing somewhere
   * unrelated: the reader deleted the note, not moved their place.
   */
  useEffect(() => {
    if (displayStripId === null) return;
    // Still loading, or not fetched for this document yet: no verdict.
    if (!savedStrips) return;
    if (savedStrips.some((strip) => strip.id === displayStripId)) {
      displayStripSeen.current = true;
      return;
    }
    if (!displayStripSeen.current) return;
    displayStripSeen.current = false;
    setDisplayStripId(null);
    setFocusMode(false);
    setSavedToast("That note was deleted, so the reading strip is closed.");
  }, [displayStripId, savedStrips]);
  const addDocumentStroke = useCallback(
    (page: number, mark: StripHighlight) => {
      if (openDocumentId == null) return;
      const next: DocumentHighlight[] = [...documentMarksRef.current, { page, ...mark }];
      documentMarksRef.current = next;
      void replaceDocumentHighlights({
        id: openDocumentId,
        highlights: serializeDocumentHighlights(next),
      });
    },
    [openDocumentId, replaceDocumentHighlights],
  );
  /**
   * Take one saved mark off the page.
   *
   * The document keeps its marks as one list, so removing is finding that row
   * and writing the rest back — the same write a new stroke makes. A mark has no
   * id of its own; it is found by its geometry, which is what the page is
   * showing: the list is rounded to hundredths when it is stored.
   */
  const removeDocumentStroke = useCallback(
    (page: number, mark: StripHighlight) => {
      if (openDocumentId == null) return;
      const index = documentMarksRef.current.findIndex(
        (candidate) =>
          candidate.page === page &&
          candidate.x0 === mark.x0 &&
          candidate.x1 === mark.x1 &&
          candidate.y === mark.y &&
          candidate.size === mark.size,
      );
      if (index < 0) return;
      const next = documentMarksRef.current.filter((_, at) => at !== index);
      documentMarksRef.current = next;
      void replaceDocumentHighlights({
        id: openDocumentId,
        highlights: serializeDocumentHighlights(next),
      });
    },
    [openDocumentId, replaceDocumentHighlights],
  );
  /**
   * The highlight pen, on or off.
   *
   * `H`, the toolbar's Highlight button and the right-click menus all mean the
   * same thing — put the pen down or pick it up. While it is down a drag across
   * a page lays a yellow stroke; the strokes belong to the document, so they
   * show in the viewer, in every note card's preview and in every window.
   *
   * `textBrushPt` is the thickness the text under the pointer asked for: a
   * right-click measures it when its menu opens, `H` when it is pressed, both
   * with `brushUnderPoint`. Arming from a line starts a little taller than that
   * line's font; with no text under the pointer the pen is armed as it always
   * was, at the default thickness.
   */
  const toggleHighlightPen = useCallback((textBrushPt?: number | null) => {
    if (!pdfRef.current) return;
    if (pdfPenBlocked) {
      setSavedToast("Finish the highlight already open first.");
      return;
    }
    setHighlightMode((on) => {
      if (on) return false;
      setHighlightBrush(setBrushSize(textBrushPt ?? DEFAULT_BRUSH_PT));
      return true;
    });
  }, [pdfPenBlocked]);
  const toggleHighlightPenRef = useRef(toggleHighlightPen);
  toggleHighlightPenRef.current = toggleHighlightPen;
  // `H` sizes the pen from the line under the pointer, and a key press has no
  // position of its own: the pointer's last one is followed here, once for the
  // window, so the key handler can read it without a render.
  useEffect(() => installPointerSpot(), []);

  useEffect(() => {
    if (!highlightMode) return;
    setHighlightSession({
      id: PDF_PEN_SESSION,
      onBrush: setHighlightBrush,
      onEscape: () => setHighlightMode(false),
      onClose: () => setHighlightMode(false),
    });
    return () => releaseHighlightSession(PDF_PEN_SESSION);
  }, [highlightMode]);
  useEffect(() => {
    // The menu is the pen's surface. A pen put down by any route — the toolbar,
    // Escape on the page, another pen taking over — takes its menu with it.
    if (!highlightMode) setHighlightMenu(null);
  }, [highlightMode]);
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

  /** The toolbar button and ⌘⌥B: toggle when docked, raise when popped out. */
  const toggleNotesPanel = useCallback(() => {
    if (notesDetached) focusNotesWindow();
    else setNotesPanelOpen((isOpen) => !isOpen);
  }, [focusNotesWindow, notesDetached]);

  /**
   * Dock the panel again when its window goes away.
   *
   * `tauri://destroyed` rather than `close-requested`: the requirement is about
   * the window being gone, however it went — the traffic light, the dock button,
   * ⌘⌥B inside it, or Rust closing it after the main window went down.
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

  /** The column's pop-out button: move the notes into a window of their own. */
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

  /**
   * The notes in a window of their own: ⌘⌥⇧B, and the same move the column's
   * pop-out button makes.
   *
   * Pressed again while that window is up, it raises the window rather than
   * opening a second one — the rule ⌘⌥B already follows for the window it
   * raises. Where a window cannot be opened at all — the plain web build has no
   * bridge, and a viewer window must not take over the notes window of the app
   * that opened it — the chord reveals the docked column instead of doing
   * nothing.
   */
  const revealNotesWindow = useCallback(() => {
    if (notesDetached) {
      focusNotesWindow();
      return;
    }
    if (!isTauri() || isViewerWindow) {
      setNotesPanelOpen(true);
      return;
    }
    void detachNotes();
  }, [detachNotes, focusNotesWindow, isViewerWindow, notesDetached]);

  /** Switch between the PDF viewer and the Notes browser. */
  const switchView = useCallback((next: AppTab) => {
    setView(next);
  }, []);

  // The PDF view is hidden, not unmounted, so a page box can stay focused after
  // the reader has gone to Notes. That hidden field would take Ctrl+Z.
  useEffect(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) return;
    if (active.closest(".is-hidden")) active.blur();
  }, [view]);

  const renderZoom = useDebouncedValue(zoom, 140);
  const thumbWidth = Math.max(72, railWidth - RAIL_CHROME);

  zoomRef.current = zoom;
  pageLayoutRef.current = pageLayout;
  stripHeightRef.current = stripHeight;
  stripBlurRef.current = stripBlur;
  recentsRef.current = recents;
  currentPageRef.current = currentPage;
  focusModeRef.current = focusMode;
  remarkedStripsRef.current = remarked;

  useEffect(() => {
    savePrefs({
      stripBase: stripHeight,
      stripBlur,
      pageLayout: pageLayoutToSave(pageLayout, isReferenceViewer),
      recents,
    });
  }, [isReferenceViewer, stripHeight, stripBlur, pageLayout, recents]);

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
      // The menu's document item is the main window's document; a reference
      // viewer's title is its own window's, which the line above sets.
      isReferenceViewer ? Promise.resolve() : setDocumentMenuName(sourceName),
    ]).catch((cause) => {
      console.error(cause);
    });
  }, [isReferenceViewer, pdf]);

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
        pageLayout: pageLayoutToSave(pageLayoutRef.current, isReferenceViewer),
        recents: rememberPage(recentsRef.current, open.name, open.path, currentPageRef.current),
      });
    };
    window.addEventListener("pagehide", persistOpenPage);
    window.addEventListener("beforeunload", persistOpenPage);
    return () => {
      window.removeEventListener("pagehide", persistOpenPage);
      window.removeEventListener("beforeunload", persistOpenPage);
    };
  }, [isReferenceViewer]);

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
    const fromLayout = layoutZoomRef.current;
    layoutZoomRef.current = false;
    const anchor = zoomAnchorRef.current;
    const scroller = scrollerRef.current;
    if (!anchor || !scroller) return;
    zoomAnchorRef.current = null;
    const page = scroller.querySelector<HTMLElement>(`[data-page="${anchor.page}"]`);
    if (!page) return;
    // Hold the anchor by moving scrollTop. That offset change is the same
    // passage at a new zoom, so it must not become a history mark.
    pdfScrollRecordSuspended.current = true;
    window.clearTimeout(pdfScrollRecordTimer.current);
    window.clearTimeout(pdfScrollSuspendRelease.current);
    pdfScrollSuspendRelease.current = window.setTimeout(() => {
      pdfScrollRecordSuspended.current = false;
    }, 80);
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

    /* Let the new page geometry reach the renderer before this frame ends.
     *
     * A column toggle resizes every page — the zoom is scaled to keep the page's
     * share of the area — and moves the scroller in the same frame. This webview
     * can then keep painting the pages at the size and offset they had before
     * the toggle, leaving the page area blank until something scrolls the
     * scroller: the column opening or closing reads as the PDF disappearing.
     * A real scroll is what repaints it, so one is made here — two pixels on the
     * next frame and back on the one after, which nobody can see — and only
     * while the reader has not scrolled in the meantime. The reader's own zoom
     * has no such problem and is left alone. */
    if (!fromLayout) return;
    const settledLeft = scroller.scrollLeft;
    const settledTop = scroller.scrollTop;
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nudge = settledTop < maxTop - 2 ? 2 : -2;
    window.requestAnimationFrame(() => {
      if (!scroller.isConnected) return;
      scroller.scrollLeft = settledLeft;
      scroller.scrollTop = settledTop + nudge;
      window.requestAnimationFrame(() => {
        if (!scroller.isConnected) return;
        // The reader took over in between: this is their offset now.
        if (Math.abs(scroller.scrollTop - (settledTop + nudge)) > 1) return;
        scroller.scrollLeft = settledLeft;
        scroller.scrollTop = settledTop;
      });
    });
  }, [zoom]);

  const closePdf = useCallback(() => {
    void pdfRef.current?.document.cleanup();
    pdfRef.current = null;
    openDocRef.current = null;
    pendingPageRestore.current = null;
    pendingStripRestore.current = null;
    setPdf(null);
    // The path is what the notes column, the badges and the detached window
    // display. Clearing the pages and leaving the path would keep the old
    // document on screen.
    setOpenPath(null);
    setCurrentPage(1);
    setHits([]);
    setActiveHit(-1);
    setSearchQuery("");
    setSearchOpen(false);
    setFocusMode(false);
    setHighlightMode(false);
    parkedCenterYRef.current = null;
    contentLockRef.current = null;
    dragLockRef.current = null;
    setStripMenu(null);
    setPageMenu(null);
    setHighlightMenu(null);
    setStripSaveState("idle");
    setStripSaveMessage(null);
    setPendingNoteEditId(null);
    setRevealStripId(null);
    // The strips of the closed document are not the ones the next one shows.
    setDisplayStripId(null);
  }, []);

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
        void pdfRef.current?.document.cleanup();
        pdfRef.current = loaded;
        openDocRef.current = { name: sourceName, path: options.path };
        setOpenPath(options.path ?? null);
        pendingPageRestore.current = targetPage;
        pendingStripRestore.current = null;
        skipRestoreUntilZoom.current = fitWidth;
        setPdf(loaded);
        setCurrentPage(spreadStart(targetPage, pageLayoutRef.current));
        setHits([]);
        setActiveHit(-1);
        setFocusMode(false);
        parkedCenterYRef.current = null;
        contentLockRef.current = null;
        dragLockRef.current = null;
        // A band parked on the old document's strip means nothing here.
        setDisplayStripId(null);
        // A page menu belongs to the page it was opened on.
        setPageMenu(null);
        setRecents((current) => rememberRecent(current, sourceName, options.path, targetPage));

        requestAnimationFrame(() => {
          const scroller = scrollerRef.current;
          const first = loaded.pages[0];
          if (fitWidth && scroller && first) {
            const widths = loaded.pages.slice(0, 2).map((page) => page.width);
            const next = clamp(fitZoom(scroller.clientWidth, widths, pageLayoutRef.current), MIN_ZOOM, MAX_ZOOM);
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
    [],
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
        setRecents((current) => dropRecent(current, path));
        setError("That file is no longer available.");
      }
    },
    [loadFromBytes],
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
      const seq = ++openSeqRef.current;
      const stillCurrent = () => openSeqRef.current === seq;
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
          if (sourcePaths.length === 1) {
            setRecents((current) => dropRecent(current, sourcePaths[0]!));
          }
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
        return stillCurrent() && openDocRef.current?.path === sourcePaths[0];
      }

      if (!stillCurrent()) return false;

      // Opening by the original path is a one-off: from now on the document is
      // the copy, which is already in Recents under its own path.
      for (const path of sourcePaths) {
        if (!documents.some((document) => document.file_path === path)) {
          setRecents((current) => dropRecent(current, path));
        }
      }
      const document = documents[0];
      if (!document) {
        setBusy(false);
        return false;
      }
      await openFromPath(document.file_path, document.name, stillCurrent);
      return stillCurrent() && openDocRef.current?.path === document.file_path;
    },
    [closePdf, importDocument, openFromPath],
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

  const fitWidth = useCallback(() => {
    const scroller = scrollerRef.current;
    const pages = pdfRef.current?.pages;
    const first = pages?.[0];
    if (!scroller || !first) return;
    const rect = scroller.getBoundingClientRect();
    const widths = pages.slice(0, 2).map((page) => page.width);
    applyZoom(
      fitZoom(scroller.clientWidth, widths, pageLayoutRef.current),
      rect.left + rect.width / 2,
      rect.top + 24,
    );
  }, [applyZoom]);

  /**
   * Switch Single Page / Two Pages without touching the zoom.
   *
   * The page the reader is on is measured first. After the pair (or the column)
   * lays out, that page is put back at the same place in the window. A spread
   * that fits stays centred; a spread wider than the window keeps the page's
   * left edge, so the facing page is the one beside it.
   */
  const choosePageLayout = useCallback((next: PageLayout) => {
    if (next === pageLayoutRef.current) return;
    const scroller = scrollerRef.current;
    const page = currentPageRef.current;
    const node = scroller?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (scroller && node) {
      const scrollerRect = scroller.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      layoutAnchorRef.current = {
        page,
        top: nodeRect.top - scrollerRect.top,
        left: nodeRect.left - scrollerRect.left,
      };
    } else {
      layoutAnchorRef.current = null;
    }
    setPageLayout(next);
  }, []);

  useLayoutEffect(() => {
    const anchor = layoutAnchorRef.current;
    if (!anchor) return;
    layoutAnchorRef.current = null;
    const scroller = scrollerRef.current;
    const node = scroller?.querySelector<HTMLElement>(`[data-page="${anchor.page}"]`);
    if (!scroller || !node) return;
    pdfScrollRecordSuspended.current = true;
    window.clearTimeout(pdfScrollRecordTimer.current);
    window.clearTimeout(pdfScrollSuspendRelease.current);
    const scrollerRect = scroller.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.min(
      maxTop,
      Math.max(0, scroller.scrollTop + nodeRect.top - scrollerRect.top - anchor.top),
    );
    const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    if (maxLeft > 0) {
      const placed = node.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      scroller.scrollLeft = Math.min(
        maxLeft,
        Math.max(0, scroller.scrollLeft + placed.left - view.left - anchor.left),
      );
    }
    dispatch(settleActivePdfScroll(scroller.scrollTop));
    pdfScrollSuspendRelease.current = window.setTimeout(() => {
      pdfScrollRecordSuspended.current = false;
    }, 80);
  }, [dispatch, pageLayout]);

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
    let left = scroller.scrollLeft;
    const overflowsLeft = nodeRect.left < scrollerRect.left - 1;
    const overflowsRight = nodeRect.right > scrollerRect.right + 1;
    // A page wider than the window overflows both sides; leave the horizontal
    // pan where the reader put it. A facing page that sits entirely off to one
    // side is brought in. Two Pages is that case.
    if (overflowsRight && !overflowsLeft) {
      left += nodeRect.right - scrollerRect.right + 12;
    } else if (overflowsLeft && !overflowsRight) {
      left += nodeRect.left - scrollerRect.left - 12;
    }
    scroller.scrollTo({ top: Math.max(0, top), left: Math.max(0, left) });
  }, []);

  /**
   * Back walks to the previous mark's offset (`prev` of the mark we leave).
   * Forward walks to the next mark's `current`. The index moves first, so the
   * scroll event that follows names a place the list already stands on and the
   * recorder does not append it.
   */
  const stepPdfScrollHistory = useCallback((direction: -1 | 1) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const before = store.getState().app.pdfScrollIndex;
    dispatch(direction < 0 ? goToPreviousPdfScroll() : goToNextPdfScroll());
    const next = store.getState().app;
    if (next.pdfScrollIndex === before) return;
    const wanted = activePdfScrollOffset(next);
    if (wanted == null) return;
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const top = Math.min(wanted, max);
    if (top !== wanted) dispatch(settleActivePdfScroll(top));
    scroller.scrollTop = top;
  }, [dispatch]);

  const goToPage = useCallback((index: number) => {
    const scroller = scrollerRef.current;
    const node = scroller?.querySelector<HTMLElement>(`[data-page="${index}"]`);
    if (!scroller || !node) return;
    const shown = spreadStart(index, pageLayoutRef.current);
    jumpingToPage.current = shown;
    setCurrentPage(shown);
    scrollScrollerTo(node, "start");
    window.setTimeout(() => {
      if (jumpingToPage.current === shown) jumpingToPage.current = null;
    }, 400);
  }, [scrollScrollerTo]);

  const goToHit = useCallback((index: number, list: SearchHit[]) => {
    const hit = list[index];
    if (!hit) return;
    const shown = spreadStart(hit.pageIndex, pageLayoutRef.current);
    jumpingToPage.current = shown;
    setCurrentPage(shown);
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
   * One layer per press. While the reading strip is on it is the first layer, ahead
   * of the event log, the band's menu, the search bar and the notes column;
   * `escapeDismiss.ts` holds the order and the reasoning. Returns whether anything
   * was actually closed, so the caller only claims the key when the press did
   * something.
   *
   * The closers are a table rather than a chain of `if`s: the list, not this
   * function, decides what Escape means.
   */
  const closeOverlays = useCallback((): boolean => {
    const closers: Record<EscapeLayer, () => void> = {
      eventLog: () => setEventLogOpen(false),
      stripMenu: () => setStripMenu(null),
      search: closeSearch,
      notesPanel: () => setNotesPanelOpen(false),
      band: () => setFocusMode(false),
    };
    const closing = closedByEscape({
      eventLog: eventLogOpen,
      stripMenu: stripMenu !== null,
      search: searchOpen,
      notesPanel: notesPanelOpen,
      band: focusMode,
    });
    if (!closing) return false;
    closers[closing]();
    return true;
  }, [closeSearch, eventLogOpen, focusMode, notesPanelOpen, searchOpen, stripMenu]);

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
  openAppWindowRef.current = () => {
    void openAppWindow().catch((cause) => {
      console.error(cause);
      setSavedToast("Could not open a new window.");
    });
  };
  const historyShortcuts = useHistoryShortcuts();
  const undoHistoryRef = useRef(historyShortcuts.undo);
  const redoHistoryRef = useRef(historyShortcuts.redo);
  undoHistoryRef.current = historyShortcuts.undo;
  redoHistoryRef.current = historyShortcuts.redo;

  useEffect(() => {
    // The menu is the app's, and a reference viewer is not a second app: its
    // File menu would only take Open and Find away from the window that has a
    // document of its own. Every full window — the original and each "Open in
    // New Window" — installs it again when it comes forward, so those commands
    // run in the window the reader is looking at.
    //
    // macOS only: on Windows the app-wide menu is drawn as a bar inside the
    // window, and that bar is the white strip above the app's own title strip.
    // `installAppMenu` guards it too; bailing out here also keeps the focus
    // listener from re-installing what Windows must not have.
    if (!isTauri() || isReferenceViewer || PLATFORM !== "macos") return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const install = () => {
      void installAppMenu({
        onOpen: () => openWithPickerRef.current(),
        onNewWindow: () => openAppWindowRef.current(),
        onUndo: () => undoHistoryRef.current(),
        onRedo: () => redoHistoryRef.current(),
        onFind: () => openSearchRef.current(),
        onFindNext: () => stepHitRef.current(1),
        onFindPrev: () => stepHitRef.current(-1),
      }).catch((cause) => {
        console.error(cause);
      });
    };
    install();
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) install();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((cause) => console.error(cause));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isReferenceViewer]);

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

  /* A docked-column toggle is one change, not two.
   *
   * The page area narrows *and* the page scales, and both have to land in the same
   * commit: scaling from the resize observer instead paints the narrower column at
   * the old zoom first — the page shifts, an overflow scrollbar appears and goes,
   * then the page shrinks — which is what reads as the viewer flickering. A layout
   * effect runs after the new DOM but before the browser paints, so the page area
   * is never shown in the state nobody asked for.
   *
   * A *window* resize and a column's own drag never come through here, and both
   * keep the page's size: there the reader asked for room around the same page.
   * The observer below still measures those.
   *
   * Both docked columns are in the dependency list for the same reason: raising
   * the event log is a request for the log, not for a bigger document, so the page
   * keeps the share of the area it had instead of being cut off at the same zoom. */
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const scroller = scrollerRef.current;
    if (!stage || !scroller) return;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    setStageSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
    /* Nothing to scale: no document, or a viewer that is not on screen — the
       Dashboard hides it, so its width reads as zero.

       The width the page was last laid out for is *not* overwritten in that case.
       The log can now be raised from the Dashboard, and coming back to the PDF tab
       has to scale against the width the page still has on that tab's books: the
       column took its room while nobody was looking, so the page keeps its share
       exactly as it would have if the column had been raised with the page on
       screen. Overwriting it with zero made the next toggle scale from nothing and
       double the zoom. */
    if (!pdfRef.current || width <= 0) return;
    const previous = stageWidthRef.current;
    stageWidthRef.current = width;
    if (previous <= 0) return;
    const next = zoomForArea(zoomRef.current, previous, width);
    if (Math.abs(next - zoomRef.current) < 1e-4) return;
    const point = layoutZoomAnchor(scroller);
    layoutZoomRef.current = true;
    applyZoom(next, point.x, point.y);
    // `view` is a dependency because a tab switch changes this viewer's width while
    // no column was toggled: the page has to be laid out for the area it has now.
  }, [applyZoom, eventLogOpen, layoutZoomAnchor, notesDetached, notesPanelOpen, view]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    /** Measure the page area. The column's own toggle is handled above. */
    const updateStageSize = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      // A hidden viewer measures zero, and that zero is not a width the page was
      // ever laid out for: writing it down here would throw away the baseline the
      // tab switch scales against (see the layout effect above), which is what made
      // the log look like it had always been there.
      if (width > 0) stageWidthRef.current = width;
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
        switchView(event.key === "1" ? "pdf" : "dashboard");
        return;
      }
      // A highlight's menu is the pen's own surface. Escape closes the menu and
      // leaves the pen armed, so the press still has a step to take before it
      // would put the pen down — the menu is a layer over the pen, not over it.
      if (event.key === "Escape" && highlightMenu) {
        event.preventDefault();
        setHighlightMenu(null);
        return;
      }
      // A note preview has the pen down. `[` / `]` size that brush, and Escape
      // cancels the stroke, ahead of the reading strip and the columns.
      if (highlightSessionKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // The notes surfaces (docked column, Dashboard tab, markdown popup) own the
      // keyboard while the event starts inside them: they bind their own ⌘F, ⌘S
      // and zoom keys, and typing a note must not also zoom the page or toggle
      // focus mode.
      const target = event.target instanceof Element ? event.target : null;

      /* Escape steps back **one layer** per press. While the reading strip is on,
         that layer is the strip: it takes the key ahead of the event log, the
         band's menu, the search bar and the notes column. The order and the
         reasoning are in `escapeDismiss.ts`. It sits above the notes-surface guard
         below on purpose: once a card has been clicked the press starts *inside*
         the column, and with the strip on that is exactly when the strip should
         go away, leaving the column where it was.

         With the strip off, the event log is the first layer, and it closes
         alone: it is a column watched while the viewer is used, not a modal, so
         a press while it is up must not also empty the find field.

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

      /* The Dashboard's Escape. The tab has one layer of its own — the log it can
         now raise — and puts that away, claiming the key only when it did. The
         editor rule above applies here too: a note field, the markdown popup or
         the tag field is holding text, so the press is theirs, not the column's.
         Nothing else on this tab is a layer, which is why this is its own branch
         rather than a `view` widened on the one above: the PDF's overlays are not
         on screen to close. */
      if (event.key === "Escape" && view === "dashboard" && eventLogOpen) {
        const keptByEditor = escapeKeptByEditor({
          noteDialogOpen: Boolean(document.querySelector(".note-backdrop")),
          typingInNotes:
            isTypingTarget(event.target) && Boolean(target?.closest(".doc-notes, .notes")),
        });
        if (keptByEditor) return;
        // The page preview is the layer in front of the log. Its own listener
        // closes it; this press must not also put the log away.
        if (document.querySelector(".notes-doc-preview")) return;
        event.preventDefault();
        setEventLogOpen(false);
        return;
      }

      /* Two chords still reach the viewer from inside the column: ⌘⌥B is how the
         column itself is raised and closed, and ⌘⌥⇧B pops it out or raises the
         window it is already in, so a press that starts in it — a card was just
         clicked, a note field has focus — has to land. Everything else stays the
         notes surfaces' own, and the markdown popup keeps ⌘⌥B too: it is modal,
         and closing the column behind it would move the page under the note being
         written. The popup is recognised by being open, not by where the press
         started — its preview pane takes no focus, and the same chord toggles that
         preview. (⌘⌥⇧B is not a chord the popup knows, so it stays with the
         viewer even then.) */
      if (
        view === "pdf" &&
        target?.closest(".doc-notes") &&
        !document.querySelector(".note-backdrop")
      ) {
        const notesChord = panelShortcut(event);
        if (notesChord === "notes-panel" || notesChord === "notes-window") {
          event.preventDefault();
          event.stopPropagation();
          if (notesChord === "notes-window") revealNotesWindow();
          else toggleNotesPanel();
          return;
        }
      }

      /* The docked columns own their keyboards the same way: typing a request id
         into the event log must not also toggle focus mode or the pages rail, and
         its own controls are what answer the keys pressed inside it. */
      if (target?.closest(".doc-notes, .notes, .note-backdrop, .event-log-panel")) return;

      if (view !== "pdf") return;

      // ⌥← and ⌥→ walk the same scroll marks as the toolbar buttons. A text
      // field keeps the chord: Option+arrow moves by a word there.
      const scrollStep = scrollHistoryShortcut(event);
      if (scrollStep) {
        if (!pdf || isTypingTarget(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        stepPdfScrollHistory(scrollStep);
        return;
      }

      // The panel chords. All move the same state their buttons do: ⌘B closes the
      // Pages rail when it is in the way and brings it back, ⌘⌥B does the same
      // for the notes column, and ⌘⌥⇧B moves that column into a window of its
      // own (or raises it, when it is already out).
      const shortcut = panelShortcut(event);
      if (shortcut === "pages") {
        if (!pdf) return;
        event.preventDefault();
        event.stopPropagation();
        setShowThumbs((value) => !value);
        return;
      }
      if (shortcut === "notes-panel") {
        if (!pdf || document.querySelector(".note-backdrop")) return;
        event.preventDefault();
        event.stopPropagation();
        // Toggles the column when it is docked; when it is popped out, there is
        // nothing here to toggle, so the chord raises that window instead.
        toggleNotesPanel();
        return;
      }
      if (shortcut === "notes-window") {
        if (!pdf || document.querySelector(".note-backdrop")) return;
        event.preventDefault();
        event.stopPropagation();
        revealNotesWindow();
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
      // On macOS this chord belongs to the File menu's "Open in New Window".
      // Windows has no app menu any more, so the same command keeps its chord
      // through the app's own key handler. Guarded by platform so the menu and
      // this handler can never both open a window for one press.
      if (PLATFORM !== "macos" && meta && event.key.toLowerCase() === "n") {
        event.preventDefault();
        openAppWindowRef.current();
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
      // H is the highlight pen, on or off — the same toggle as the toolbar's
      // Highlight button and the right-click menus. It goes through a ref
      // because the handler is installed once and the pen's state is whichever
      // render is current.
      //
      // The pen also starts at the line under the pointer, exactly as the page's
      // right-click menu does, so the key and the menu arm the same brush over
      // the same words. A key press carries no coordinates, so the pointer's
      // last move is what "under the pointer" means; bare paper — or a pointer
      // not seen since the window opened — leaves the pen at its own thickness.
      if (event.key.toLowerCase() === "h" && !meta && !event.altKey) {
        if (isTypingTarget(event.target)) return;
        if (event.repeat || event.isComposing) return;
        event.preventDefault();
        const spot = pointerSpot();
        toggleHighlightPenRef.current(spot ? brushUnderPoint(spot.x, spot.y) : null);
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
    eventLogOpen,
    fitWidth,
    focusMode,
    highlightMenu,
    openSearch,
    openWithPicker,
    pdf,
    revealNotesWindow,
    searchOpen,
    setStripHeight,
    stepHit,
    stepPdfScrollHistory,
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

      const scrollerRect = scroller.getBoundingClientRect();
      const anchor = scrollerRect.top + Math.min(120, scroller.clientHeight * 0.22);
      let best = Number(pages[0]?.dataset.page) || 1;
      let bestDelta = Infinity;
      for (const node of pages) {
        const rect = node.getBoundingClientRect();
        // Two Pages: a facing page scrolled off to the side is not the one on
        // screen. The leftmost page still in the window wins, then the spread's
        // first page is what the counter and the thumbnails name.
        if (pageLayout === "two") {
          const onScreen = rect.right > scrollerRect.left + 8 && rect.left < scrollerRect.right - 8;
          if (!onScreen) continue;
        }
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
      if (pageLayout === "two") best = spreadStart(best, pageLayout);
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
  }, [pdf, zoom, showThumbs, railWidth, pageLayout]);

  /**
   * Remember where the PDF scroller rests.
   *
   * The wheel, the scrollbar and a middle-button drag all emit `scroll`. A
   * click that jumps to a page, a search hit or a saved strip often does not:
   * it writes `scrollTop` or calls `scrollTo`, and this webview sometimes
   * applies that write without an event. So the event is listened for, and
   * the offset itself is sampled on a short interval. Either one resets the
   * same debounce, and the mark is the offset once it has sat still.
   *
   * Opening a document seeds the list with wherever the scroller already is
   * (often a restored page) and drops the previous document's marks. Those
   * offsets belong to a different file. A zoom correction is not a new place;
   * while it rewrites the offset the sample follows it without recording.
   */
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!pdf || !scroller) {
      dispatch(clearPdfScrollPositions());
      return;
    }

    dispatch(clearPdfScrollPositions());
    dispatch(recordPdfScrollPosition(scroller.scrollTop));

    let last = Math.round(scroller.scrollTop);
    const schedule = () => {
      window.clearTimeout(pdfScrollRecordTimer.current);
      pdfScrollRecordTimer.current = window.setTimeout(() => {
        if (pdfScrollRecordSuspended.current) return;
        dispatch(recordPdfScrollPosition(scroller.scrollTop));
      }, PDF_SCROLL_RECORD_MS);
    };
    const note = () => {
      const top = Math.round(scroller.scrollTop);
      if (pdfScrollRecordSuspended.current) {
        last = top;
        window.clearTimeout(pdfScrollRecordTimer.current);
        return;
      }
      if (top === last) return;
      last = top;
      schedule();
    };

    // A frame callback pauses while this view is in the background, and a
    // `scrollTop` write often has no event at all. An interval still notices
    // the offset. The scroll listener is the prompt path when an event does fire.
    const sample = window.setInterval(note, 50);
    scroller.addEventListener("scroll", note, { passive: true });
    return () => {
      window.clearInterval(sample);
      window.clearTimeout(pdfScrollRecordTimer.current);
      window.clearTimeout(pdfScrollSuspendRelease.current);
      pdfScrollRecordSuspended.current = false;
      scroller.removeEventListener("scroll", note);
    };
  }, [pdf, dispatch]);

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

  /**
   * The hole's width.
   *
   * Single Page leaves it the full stage. Two Pages cuts it to the page the
   * strip is locked to — a saved note's page, or the page a double-click parked
   * it on — so the clear band does not open the facing page as well. A page
   * that has scrolled off the side leaves no hole there.
   */
  const placeHoleSpan = useCallback((stage: HTMLElement, overlay: HTMLElement) => {
    const scroller = scrollerRef.current;
    const fullStage = () => {
      overlay.classList.remove("is-paged-hole");
      overlay.style.setProperty("--hole-left", "0px");
      overlay.style.setProperty("--hole-width", "100%");
    };
    if (pageLayoutRef.current !== "two" || !scroller) {
      fullStage();
      return;
    }
    const lock = contentLockRef.current;
    const stageRect = stage.getBoundingClientRect();
    const locked = lock
      ? scroller.querySelector<HTMLElement>(`[data-page="${lock.page}"]`)
      : null;
    const holeTop = Number.parseFloat(overlay.style.getPropertyValue("--hole-top")) || 0;
    const page = locked ?? pageElementAtPoint(
      scroller,
      stageRect.left + stageRect.width / 2,
      stageRect.top + holeTop,
    );
    if (!page) {
      fullStage();
      return;
    }
    const pageRect = page.getBoundingClientRect();
    const span = pageHoleSpan(
      stageRect.width,
      pageRect.left - stageRect.left,
      pageRect.right - stageRect.left,
    );
    overlay.classList.add("is-paged-hole");
    overlay.style.setProperty("--hole-left", `${span.left}px`);
    overlay.style.setProperty("--hole-width", `${span.width}px`);
  }, []);

  const layoutFocusOverlay = useCallback(() => {
    const stage = stageRef.current;
    const overlay = focusOverlayRef.current;
    if (!stage || !overlay) return;
    const drag = dragLockRef.current;
    if (drag) {
      overlay.style.setProperty("--hole-top", `${drag.holeTop}px`);
      overlay.style.setProperty("--hole-height", `${drag.holeHeight}px`);
      placeHoleSpan(stage, overlay);
      return;
    }
    const height = stripScreenPx(stripHeightRef.current, zoomRef.current);
    const centerY = bandCenterY(stage);
    overlay.style.setProperty("--hole-top", `${centerY - height / 2}px`);
    overlay.style.setProperty("--hole-height", `${height}px`);
    placeHoleSpan(stage, overlay);
  }, [bandCenterY, placeHoleSpan]);

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
    // The hole takes no pointer events, so `:hover` never reaches it. The
    // brighter borders are this class instead, toggled while the pointer is
    // inside the band.
    const band = focusOverlayRef.current?.querySelector(".focus-band");
    if (!(band instanceof HTMLElement)) return;
    const rect = band.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    band.classList.toggle("is-hot", inside);
  };

  const onStagePointerLeave = () => {
    focusOverlayRef.current?.querySelector(".focus-band")?.classList.remove("is-hot");
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
    // Two Pages: the area being drawn belongs to the page under the press, not
    // the whole stage. The facing page stays outside the strip.
    const drawnPage =
      pageLayoutRef.current === "two"
        ? pageElementAtPoint(scrollerRef.current, event.clientX, event.clientY)
        : null;

    /** Draw one frame of the area, and keep it: the release commits the last one. */
    const show = (band: ReturnType<typeof stripSelectBand>) => {
      if (marquee) {
        marquee.style.display = band.chosen ? "block" : "none";
        marquee.style.top = `${band.top}px`;
        marquee.style.height = `${band.height}px`;
        if (drawnPage) {
          const box = host.getBoundingClientRect();
          const pageRect = drawnPage.getBoundingClientRect();
          const span = pageHoleSpan(
            box.width,
            pageRect.left - box.left,
            pageRect.right - box.left,
          );
          marquee.style.left = `${span.left}px`;
          marquee.style.right = "auto";
          marquee.style.width = `${span.width}px`;
        } else {
          marquee.style.left = "0";
          marquee.style.right = "0";
          marquee.style.width = "";
        }
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
      // The band rides the page under its centre. In Single Page that point is
      // the stage's own middle rather than the pointer, because the area is the
      // full width of the stage and the pointer may have left the page sideways.
      // In Two Pages the area is one page, so the lock is that page's centre —
      // the stage's middle may be the facing page.
      const pageRect = drawnPage?.getBoundingClientRect();
      const commitX = pageRect ? pageRect.left + pageRect.width / 2 : box.left + box.width / 2;
      commitStripCenter(commitX, box.top + centerY, centerY);
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
   * button pans the page in both directions.
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
    // Middle-button drag pans the document on both axes. A page is often wider
    // than the window — zoomed in, or reading two pages — and a vertical-only
    // pan left the far end of every line reachable only by the wheel's sideways
    // gesture or the scrollbar, which is a poor answer to "drag the paper
    // around". The scroll is a plain `scrollTop` / `scrollLeft` write, so the
    // scroll spy and the strip's scroll re-layout both pick it up exactly as
    // they do for a wheel scroll. The band no longer takes the press, so the
    // gesture works inside the reading hole as well.
    const scroller = scrollerRef.current;
    const stage = stageRef.current;
    if (!scroller || !stage) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    stage.setPointerCapture(pointerId);
    stage.classList.add("panning");
    const startX = event.clientX;
    const startY = event.clientY;
    const startScrollLeft = scroller.scrollLeft;
    const startScrollTop = scroller.scrollTop;

    const onMove = (move: PointerEvent) => {
      // The paper follows the pointer: dragging right brings what was off the
      // left edge into view, which is the direction a hand expects from a page
      // it has grabbed.
      scroller.scrollLeft = startScrollLeft - (move.clientX - startX);
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
        // `slack` is the opening built in, so the passage is framed on arrival
        // instead of after a couple of `]` presses.
        const paragraph = findParagraphAt(liveBoxes.length > 0 ? liveBoxes : fallbackBoxes, x, y, {
          minHeight: MIN_STRIP,
          maxHeight: MAX_STRIP,
          slack: DOUBLE_CLICK_SLACK,
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
   * open. Shared by the Dashboard tab (after it has opened the document), the docked
   * panel (where it always is), and a note badge's double-click.
   *
   * `keepScroll` parks the band where the strip already is on screen instead of
   * scrolling the page to bring the strip to the reading line. That is the badge's
   * case: the badge is hanging on the strip in view, so scrolling would move the
   * page out from under the passage the reader is looking at — and out from under
   * the badge they just pressed.
   */
  const parkSavedStrip = useCallback(
    (strip: Note, options: { keepScroll?: boolean } = {}) => {
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

  /**
   * A viewer window: open the document it was opened for.
   *
   * Once, and after the first render: the window is a normal viewer from that
   * point on. `openViaLibrary` is the same open the Notes list and the recents
   * menu use — the document is already a library copy, so it answers from the
   * row it has rather than copying anything.
   *
   * A window opened on a note starts in single page mode, with the notes column
   * folded. The passage is the reading strip on that one page; a two-page spread
   * would put another page beside it, and the column would narrow the page
   * before the strip is parked. The column stays one click away, the same as a
   * window opened on the document alone.
   */
  const referenceOpenStarted = useRef(false);
  const [referenceDocumentReady, setReferenceDocumentReady] = useState(false);
  useEffect(() => {
    if (!viewerRequest || referenceOpenStarted.current) return;
    referenceOpenStarted.current = true;
    void (async () => {
      if (await openViaLibrary(viewerRequest.filePath)) setReferenceDocumentReady(true);
    })();
  }, [viewerRequest, openViaLibrary]);

  /**
   * Then show the note itself on the page.
   *
   * `parkSavedStrip` is the viewer's own "stand on this strip" — the state a
   * note card's click and a badge's double-click produce, with the band over
   * the note's band of the page, focus mode on and the page scrolled to it.
   * `revealStripId` is remembered for the column, so opening "Notes of this PDF"
   * later lands on that card. The column itself stays closed.
   *
   * Waiting for the document is what keeps this from applying to a page that is
   * still the previous document's.
   */
  const referenceStripPlaced = useRef(false);
  useEffect(() => {
    if (!referenceDocumentReady || !referenceStrip || referenceStripPlaced.current) return;
    referenceStripPlaced.current = true;
    setRevealStripId(referenceStrip.id);
    parkSavedStrip(referenceStrip);
  }, [referenceDocumentReady, referenceStrip, parkSavedStrip]);

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
      subscribe<OpenStripRequest>(NotesEvent.OpenStrip, ({ strip }) => {
        parkSavedStripRef.current(strip);
        // The band follows the card, but this window does not come forward with
        // it: the press happened in the popped-out column, and raising this one
        // would take the caret out of the note the reader just clicked. They see
        // the band move behind the other window, and keep typing/clicking where
        // they are.
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
      subscribe<CacheStalePayload>(NotesEvent.CacheStale, (payload) => {
        // Another window wrote something. It does not say what, and it does not
        // have to: every tag type goes stale, and RTK Query refetches what this
        // window is showing. Its own announcement is skipped — the mutation's
        // effects are already here.
        if (payload.source === currentLabel()) return;
        invalidateEveryTag(dispatch);
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
    (strip: Note) => {
      showNotes();
      setRevealStripId(strip.id);
    },
    [showNotes],
  );

  /**
   * Show the note a `[note:<id>]` reference inside another note points at.
   *
   * One function for every view, because the answer is the same everywhere: the
   * note opens in a **viewer window of its own**, on the document it belongs to,
   * in single page mode, with the reading strip parked on that note's band and
   * the notes column closed. A reference is
   * cross-document by design — it was copied out of one document's note and
   * pasted into another's — so a viewer is the one answer that works from the
   * docked column, the popped-out column and the Dashboard tab alike, and it leaves
   * the window the reader was in exactly as it was.
   *
   * Always a new window: following a reference twice is two looks at the same
   * passage, and the second look must not be answered by moving the first. The
   * window is an independent instance of this app — its own pages, zoom and
   * store — so nothing it does can disturb the document on this side.
   */
  const showReferencedNote = useCallback(
    async (strip: NoteWithDocument) => {
      const document = strip.pdf_document;
      if (!document) return;

      if (isTauri()) {
        try {
          await openReferenceViewerWindow({ filePath: document.file_path, noteId: strip.id });
          return;
        } catch (cause) {
          console.error(cause);
          setSavedToast("Could not open the note's window.");
          return;
        }
      }

      // The plain web build has no second window: the docked column is the only
      // viewer there is, and it only ever shows the open PDF.
      if (openPath === document.file_path) {
        showNotes();
        setRevealStripId(strip.id);
        return;
      }
      setSavedToast(`That note is in “${document.name}”.`);
    },
    [openPath, showNotes],
  );

  /**
   * The click handler as the list receives it.
   *
   * A `useCallback` rather than an arrow in the JSX: it reaches every note card
   * through `MarkdownNote`, which is memoised, and a new function per render
   * would re-parse every note in the column each time the toast or a page tick
   * re-rendered this component.
   */
  const revealReferencedNote = useCallback(
    (strip: NoteWithDocument) => void showReferencedNote(strip),
    [showReferencedNote],
  );
  /**
   * The popped-out column's request for the same thing.
   *
   * That window can reveal a reference to a note it holds, but a reference into
   * another PDF is an open, and opening belongs here — so the click travels over
   * the bridge and lands on the same function the docked column calls.
   */
  const showReferencedNoteRef = useRef(showReferencedNote);
  showReferencedNoteRef.current = showReferencedNote;
  useEffect(
    () =>
      subscribe<{ strip: NoteWithDocument }>(NotesEvent.ShowNote, ({ strip }) => {
        void showReferencedNoteRef.current(strip);
      }),
    [],
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
    (strip: Note, event: ReactMouseEvent<HTMLButtonElement>) => {
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
    (strip: Note) => {
      if (remarkClickTimer.current !== null) {
        window.clearTimeout(remarkClickTimer.current);
        remarkClickTimer.current = null;
      }
      parkSavedStrip(strip, { keepScroll: true });
    },
    [parkSavedStrip],
  );

  /**
   * A document left the library. When it is the PDF on screen and one document
   * is left, that document is opened: the deleted row's library copy is already
   * gone, so resolving it would ask for a path that is no longer a file.
   * Otherwise resolve the deleted path once more. A file that is still there
   * (the delete did not own it) stays on screen. A file that is gone closes.
   */
  const onDocumentDeleted = useCallback(
    async (document: PdfDocumentListItem) => {
      const remaining = pdfDocumentApi.endpoints.listDocuments.select()(store.getState()).data ?? [];
      const next = deletedOpenDocument(openDocRef.current?.path, document.file_path, remaining);
      if (next.action === "leave") return;
      if (next.action === "open") {
        setRecents((current) => dropRecent(current, document.file_path));
        await openViaLibrary(next.file_path, next.name);
        return;
      }
      try {
        await resolveDocument(
          {
            file_path: next.file_path,
            // This window was opened beside another. Resolving here must not
            // replace the document the app restores.
            ...(isViewerWindow ? { in_new_window: true } : {}),
          },
          false,
        ).unwrap();
      } catch (cause) {
        if (openDocRef.current?.path !== document.file_path) return;
        if ((cause as { status?: unknown }).status !== 404) return;
        setRecents((current) => dropRecent(current, document.file_path));
        closePdf();
        setError("That file is no longer available.");
      }
    },
    [closePdf, isViewerWindow, openViaLibrary, resolveDocument],
  );

  /**
   * The Notes list asked to read this document.
   *
   * The same open a strip uses, without parking a band: the library copy becomes
   * the PDF on screen, and the viewer comes forward so that is what is showing.
   * A file that can no longer be opened leaves the reader on the Dashboard tab,
   * where the failure was already reported.
   */
  const openDocumentFromNotes = useCallback(
    async (document: PdfDocumentListItem) => {
      switchView("pdf");
      if (openDocRef.current?.path === document.file_path) return;
      if (!(await openViaLibrary(document.file_path, document.name))) switchView("dashboard");
    },
    [openViaLibrary],
  );

  /**
   * The Notes list asked to read this document somewhere else.
   *
   * "Open PDF in new window" is the other half of the open above: the same
   * library copy, resolved in a window of its own, so the page on screen here is
   * left exactly where it was. Nothing about this window changes — not the tab,
   * not the document, not the scroll — which is the point of asking for a second
   * one.
   *
   * A window that fails to open is reported here rather than there, because there
   * is nothing to show it in.
   */
  const openDocumentInNewWindow = useCallback(async (document: PdfDocumentListItem) => {
    try {
      await openDocumentViewerWindow({
        documentId: document.id,
        filePath: document.file_path,
        documentName: document.name,
      });
    } catch (cause) {
      console.error(cause);
      setSavedToast("Could not open the document's window.");
    }
  }, []);

  const openStripFromNotes = useCallback(
    async (document: PdfDocumentListItem, strip: Note) => {
      switchView("pdf");

      // A legacy document's path changes during the open — it is upgraded to its
      // library copy — so the open has to answer for itself rather than being
      // checked afterwards against `document.file_path`.
      const alreadyOpen = openDocRef.current?.path === document.file_path;
      if (!alreadyOpen && !(await openViaLibrary(document.file_path, document.name))) {
        // The file moved or was deleted; the open already said so.
        switchView("dashboard");
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
        // Saving a strip in a window of its own still resolves the document,
        // and that resolve must not become the one the app restores.
        ...(isViewerWindow ? { in_new_window: true } : {}),
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
  }, [createStrip, displayStripId, isViewerWindow, resolveDocument, showNotes, updateStrip]);

  /** Right-click on the display strip opens the menu at the cursor. */
  const onStripContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    textBrushPt: number | null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setStripSaveState("idle");
    setStripSaveMessage(null);
    setStripMenu({ x: event.clientX, y: event.clientY, brushPt: textBrushPt });
  };

  /**
   * Right-click anywhere on the page.
   *
   * The native menu stays closed: the viewer has its own. The hole no longer
   * takes the press — that is what lets the text under it be selected — so a
   * right-click in the strip lands on the page and is recognised by where it
   * fell, not by which element received it.
   *
   * Two menus, one for each side of that line. Inside the band, the band's menu
   * — save the note, plus the pen toggle. Outside it, the page's menu, which
   * offers the same pen toggle: before it, the Highlight button was the only way
   * to arm the pen, and it sits in a toolbar away from the passage about to be
   * marked.
   */
  const onStageContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const target = event.target;
    const ownedByControl =
      target instanceof Element &&
      target.closest(".remark-marker, .search-bar, .strip-menu") !== null;
    if (ownedByControl) return;
    // The line the press landed on is the passage about to be marked, and its
    // font height is the brush it wants. Read here, where the press was: by the
    // time the menu item is clicked the pointer is on the menu.
    const textBrushPt = brushUnderPoint(event.clientX, event.clientY);
    const band = focusOverlayRef.current?.querySelector(".focus-band");
    const rect = band instanceof HTMLElement ? band.getBoundingClientRect() : null;
    if (
      readingHoleTakesContextMenu({
        focusOn: focusMode,
        x: event.clientX,
        y: event.clientY,
        hole: rect
          ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
          : null,
        ownedByControl,
      })
    ) {
      onStripContextMenu(event, textBrushPt);
      return;
    }

    // Outside the band (or with no band): the page's own menu. It belongs to a
    // page the press actually landed on — a right-click in the dark beside the
    // page is not about a passage.
    if (!(target instanceof Element) || !target.closest(".page-shell")) return;
    setPageMenu({ x: event.clientX, y: event.clientY, brushPt: textBrushPt });
  };

  /**
   * "Copy as reference": `[note:<id>]` on the clipboard.
   *
   * Only a band standing on a saved strip has an id to point at, so the item is
   * offered from that band alone. The menu closes first: the write is async and
   * a menu left hanging over the page reads as a stuck one.
   */
  const copyDisplayStripReference = useCallback(async () => {
    if (displayStripId === null) return;
    setStripMenu(null);
    const reference = noteReferenceMarkdown(displayStripId);
    const copied = await copyTextToClipboard(reference);
    setSavedToast(
      copied
        ? `Copied ${reference} — paste it into a note to point at this one.`
        : "Could not copy the reference to the clipboard.",
    );
  }, [displayStripId]);

  const onStageDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    parkFocusAtPoint(event.clientX, event.clientY, event.target);
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let suppressSelection = false;
    /**
     * The last press was not the selection button.
     *
     * A right-click opens a menu; it is not a gesture on the page. WebKit can
     * still begin a text selection from the press that opens that menu, leaving
     * the word picked out under it as if the app had chosen the passage for the
     * reader. The selection such a press would start is refused, and one that has
     * already started by the time the menu opens is dropped.
     */
    let menuPress = false;
    /** What was selected when the menu's press began, so a kept selection survives. */
    let selectedBeforeMenuPress = "";

    const onMouseDown = (event: MouseEvent) => {
      menuPress = event.button !== 0;
      selectedBeforeMenuPress = menuPress ? (window.getSelection()?.toString() ?? "") : "";
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
      if (!suppressSelection && !menuPress) return;
      event.preventDefault();
    };
    /** A menu's press must not leave the text it landed on selected. */
    const dropMenuPressSelection = () => {
      if (!menuPress) return;
      const selection = window.getSelection();
      if (!selection || selection.toString() === selectedBeforeMenuPress) return;
      selection.removeAllRanges();
    };
    const onContextMenu = () => dropMenuPressSelection();
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 2) dropMenuPressSelection();
      menuPress = false;
    };
    stage.addEventListener("mousedown", onMouseDown, true);
    stage.addEventListener("selectstart", onSelectStart, true);
    stage.addEventListener("contextmenu", onContextMenu, true);
    // On the window: a right-press may be released outside the page, and the
    // next selection must not be refused because that press never ended here.
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("pointerup", onMouseUp, true);
    return () => {
      stage.removeEventListener("mousedown", onMouseDown, true);
      stage.removeEventListener("selectstart", onSelectStart, true);
      stage.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("pointerup", onMouseUp, true);
    };
  }, [parkFocusAtPoint]);

  /* A click outside the band no longer turns the strip off.
   *
   * Any click in the dark veil used to end the session, which made the page
   * itself unusable while reading: a click that missed the hole — reaching for a
   * word above it, clicking between two paragraphs — closed the strip the reader
   * was in the middle of. Leaving focus mode is now only ever deliberate: `Esc`
   * (which turns the strip off and leaves the other panels where they are), `F`,
   * or the toolbar's **Focus** toggle.
   *
   * So a click beside the band is the page's own again. The veil is drawn by
   * `.focus-overlay`, which takes no pointer events, so the press lands on the
   * page under it: it selects text, it does not move the strip — and a
   * double-click still *moves* the band to the paragraph that was hit
   * (`parkFocusAtPoint`), which parks the new strip without needing the old one
   * cleared first.
   */

  const rejectNonPdfDrop = () => {
    setSavedToast("Drop a PDF to open it.");
  };

  /**
   * A file dragged in from the desktop, in the plain web build.
   *
   * Tauri never delivers the drop here: the webview listener below has the real
   * paths, and opening the browser `File` as well would read the original a
   * second time. The handlers stay on the root so the target is the window,
   * not the empty card.
   */
  const onFileDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (isTauri()) return;
    if (!dragTypesIncludeFiles(event.dataTransfer.types)) return;
    event.preventDefault();
    setPdfDropActive(true);
  };

  const onFileDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (isTauri()) return;
    if (!dragTypesIncludeFiles(event.dataTransfer.types)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const onFileDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (isTauri()) return;
    // Crossing a control inside the window fires leave with the next element
    // still inside the root. Only a leave that has actually exited dismisses
    // the veil, or it would flicker on every button the pointer passes.
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setPdfDropActive(false);
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setPdfDropActive(false);
    if (isTauri()) return;
    const files = Array.from(event.dataTransfer.files);
    const pdfs = files.filter(isPdfFile);
    if (pdfs.length > 0) {
      await onHtmlFiles(pdfs);
      return;
    }
    if (files.length > 0) rejectNonPdfDrop();
  };

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter") {
          setPdfDropActive(showPdfDropVeil(event.payload.paths));
          return;
        }
        if (event.payload.type === "leave") {
          setPdfDropActive(false);
          return;
        }
        if (event.payload.type !== "drop") return;
        setPdfDropActive(false);
        const paths = pdfPaths(event.payload.paths);
        if (paths.length > 0) {
          void openViaLibrary(paths);
          return;
        }
        if (event.payload.paths.length > 0) rejectNonPdfDrop();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((cause) => {
        console.error(cause);
      });
    // A drag that ends by the window losing focus does not always send leave.
    const onBlur = () => setPdfDropActive(false);
    window.addEventListener("blur", onBlur);
    return () => {
      cancelled = true;
      unlisten?.();
      window.removeEventListener("blur", onBlur);
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
    pageLayout,
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
   * `null` when the viewer is not on screen to measure — the Dashboard tab hides it —
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
    const stored = appState.notes_panel_width;
    if (stored != null && stored > 0) {
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
      void updateAppState({ notes_panel_width: Math.round(settled.width) });
    };
    // Interrupted, the column settles where the drag left it: the width is already
    // that on screen, and `onUp` is what writes it down.
    const stopOnBlur = endDragOnBlur(onUp);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  /**
   * Widest the event log may be right now, in px.
   *
   * The same invariant as the notes column's: the stage is what is left of the row
   * once every docked column has taken its share, so adding this column's own
   * width back gives what the page and it are dividing — and the ceiling means the
   * page keeps its minimum however wide the other columns are.
   */
  const eventLogPanelMaxWidth = useCallback((): number | null => {
    const stageWidth = stageRef.current?.getBoundingClientRect().width ?? 0;
    if (stageWidth <= 0) return null;
    const columnWidth = eventLogPaneRef.current?.getBoundingClientRect().width ?? 0;
    return maxEventLogPanelWidth(stageWidth + columnWidth);
  }, []);

  // Remembered in the backend like the notes width, and applied once for the same
  // reason: a later invalidation must not fight a drag.
  useEffect(() => {
    if (eventLogPanelWidthLoaded.current || !appState) return;
    eventLogPanelWidthLoaded.current = true;
    const stored = appState.event_log_panel_width;
    if (stored != null && stored > 0) {
      setEventLogWidth(
        clamp(stored, MIN_EVENT_LOG_PANEL, eventLogPanelMaxWidth() ?? maxEventLogPanelWidth(0)),
      );
    }
  }, [appState]);

  // A width is remembered, the window is not: the ceiling the drag uses is
  // re-applied whenever the viewer changes size, and a width that already fits is
  // left untouched.
  useLayoutEffect(() => {
    const max = eventLogPanelMaxWidth();
    if (max === null) return;
    setEventLogWidth((width) => (width > max ? max : width));
  }, [stageSize, eventLogPanelMaxWidth]);

  /**
   * Drag the log's left edge — the same gesture as the notes column's, with the
   * same release rule (settle at a usable width, or close if dragged shut). The
   * width lives in state while dragging and is written once, on release.
   */
  const onEventLogResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pane = eventLogPaneRef.current;
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
    const maxWidth = eventLogPanelMaxWidth() ?? maxEventLogPanelWidth(0);
    let width = startWidth;

    const onMove = (move: PointerEvent) => {
      // Dragging left widens the column. The floor is 0, not the minimum: dragging
      // all the way in is how it is closed, and it should follow the pointer.
      width = clamp(startWidth + (startX - move.clientX), 0, maxWidth);
      if (width >= MIN_EVENT_LOG_PANEL) lastEventLogPanelWidthRef.current = width;
      setEventLogWidth(width);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      stopOnBlur();
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      if (Math.abs(width - startWidth) < 1) return;

      const settled = resolveEventLogPanelDrag(width, maxWidth);
      if (settled.kind === "close") {
        // Dragged shut: put the width back so the title bar's button reopens the
        // log at a usable size.
        setEventLogWidth(restoredEventLogPanelWidth(lastEventLogPanelWidthRef.current, maxWidth));
        setEventLogOpen(false);
        return;
      }

      setEventLogWidth(settled.width);
      lastEventLogPanelWidthRef.current = settled.width;
      // Fire and forget: forgetting the width only means the next launch starts
      // at the default.
      void updateAppState({ event_log_panel_width: Math.round(settled.width) });
    };
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
  const facingPage = pdf ? spreadEnd(currentPage, pdf.pages.length, pageLayout) : null;

  return (
    <div
      className="app"
      onDragEnter={onFileDragEnter}
      onDragOver={onFileDragOver}
      onDragLeave={onFileDragLeave}
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
      {/* The row under the chrome: whichever tab is on screen, and the event log
          docked beside it. The log belongs here rather than inside the PDF view
          because it is a column of the window, not of the page: raised from the
          Dashboard, it has to take its width from the notes the same way it takes
          it from the page. */}
      <div className="app-body">
      {/* The PDF view stays mounted while the Dashboard tab is open: unmounting the
          scroller would throw away every rendered page canvas and the scroll
          position, for a tab switch that should be instant. */}
      <div className={`pdf-view${view === "pdf" ? "" : " is-hidden"}`}>
      {/* The window's second chrome row, and a drag surface on the same terms as
          the title strip above it: `data-tauri-drag-region="deep"` moves the
          window on a press anywhere in the row that is not a control — the gaps
          between clusters, the page readout, the zoom percentage. Tauri's handler
          refuses to drag when the press's path crosses a clickable element, so
          Open PDF still opens and the steppers still step; see `TitleBar`. */}
      <header className="toolbar" data-tauri-drag-region="deep">
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
                {facingPage != null && <span className="page-jump-mate">– {facingPage}</span>}
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
            type="button"
            className="icon zoom-step"
            onClick={() => stepPdfScrollHistory(-1)}
            disabled={!pdf || !canGoToPreviousScroll}
            aria-label="Previous scroll position"
            title={`Back to the previous scroll position (${SHORTCUT.chord(SHORTCUT.alt, "←")})`}
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="icon zoom-step"
            onClick={() => stepPdfScrollHistory(1)}
            disabled={!pdf || !canGoToNextScroll}
            aria-label="Next scroll position"
            title={`Forward to a more recent scroll position (${SHORTCUT.chord(SHORTCUT.alt, "→")})`}
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>

        <div className="toolbar-cluster">
          <button
            className={highlightMode ? "ghost active" : "ghost"}
            onClick={() => toggleHighlightPen()}
            aria-pressed={highlightMode}
            disabled={!pdf || pdfPenBlocked}
            title={
              pdfPenBlocked
                ? "Finish the highlight already open"
                : "Highlight this PDF — drag across a line; right-click a highlight to delete it"
            }
          >
            Highlight
          </button>
          {highlightMode && (
            <label className="strip-control" title="Brush size">
              <span>{highlightBrush}</span>
              <input
                type="range"
                min={MIN_BRUSH_PT}
                max={MAX_BRUSH_PT}
                value={highlightBrush}
                aria-label="Brush size"
                onChange={(event) => setHighlightBrush(setBrushSize(Number(event.target.value)))}
              />
            </label>
          )}
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
          <PageLayoutMenu layout={pageLayout} onChange={choosePageLayout} />
          {/* Icons rather than the `−` / `+` characters: a glyph sits on the
              font's baseline in whatever width the font gives it, so the two
              halves of one control were different sizes and neither was centred
              in its square. A 15px stroked icon is the same mark in both, inside
              the row's own pill height (`.zoom-step`). */}
          <button
            className="icon zoom-step"
            onClick={() => bumpZoom(1 / ZOOM_STEP)}
            disabled={!pdf}
            aria-label="Zoom out"
          >
            <Minus size={15} aria-hidden />
          </button>
          <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
          <button
            className="icon zoom-step"
            onClick={() => bumpZoom(ZOOM_STEP)}
            disabled={!pdf}
            aria-label="Zoom in"
          >
            <Plus size={15} aria-hidden />
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
          title={`Notes of this PDF — saved strips beside the page (${SHORTCUT.chord(SHORTCUT.mod, SHORTCUT.alt, "B")}, or ${SHORTCUT.chord(SHORTCUT.mod, SHORTCUT.alt, SHORTCUT.shift, "B")} in a window)`}
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
                title={`Pages (${SHORTCUT.chord(SHORTCUT.mod, "B")})`}
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
                  active={sameSpread(page.index, currentPage, pageLayout)}
                  lead={page.index === currentPage}
                  onSelect={goToPage}
                />
              ))}
            </nav>
            {/* The backend status line closes this column instead of sitting in
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
            <button
              className="thumbs-label"
              onClick={() => setShowThumbs(true)}
              title={`Pages (${SHORTCUT.chord(SHORTCUT.mod, "B")})`}
            >
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
          onPointerLeave={onStagePointerLeave}
          onDoubleClick={onStageDoubleClick}
          onContextMenu={onStageContextMenu}
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
              <div
                className={pageLayout === "two" ? "pages is-spread" : "pages"}
                style={{
                  ["--zoom" as string]: String(zoom),
                  ["--spread-gap" as string]: `${SPREAD_GAP_PX}px`,
                }}
              >
                {pairPages(pdf.pages).map((pair) => (
                  <div className="page-spread" key={`${pdf.sourceName}-spread-${pair[0]!.index}`}>
                    {pair.map((page) => (
                      <PdfPageView
                        key={`${pdf.sourceName}-${page.index}`}
                        page={page}
                        renderZoom={renderZoom}
                        hits={hitsByPage.get(page.index) ?? NO_HITS}
                        activeHit={activeHit}
                        marks={documentMarks.filter((mark) => mark.page === page.index)}
                        highlighting={highlightMode}
                        onStroke={(mark) => addDocumentStroke(page.index, mark)}
                        onMarkContextMenu={(mark, x, y) => setHighlightMenu({ page: page.index, mark, x, y })}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ) : busy ? (
              <div className="empty" role="status">
                <div className="pdf-opening">
                  <span className="spinner" aria-hidden />
                  <p>Opening PDF…</p>
                </div>
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
                    <div>Drop a PDF anywhere · <ShortcutKeys keys={[SHORTCUT.mod, "O"]} /> to open</div>
                    <div>Double-click a paragraph to focus · <kbd>{SHORTCUT.mod}</kbd>{IS_WINDOWS ? "+" : " "}drag to draw the strip · right-click the band to save it as a note · <kbd>H</kbd> toggles the highlight pen · right-click → Toggle highlight · middle-drag to pan · drag a border to resize · <kbd>Esc</kbd> closes the strip first · <kbd>F</kbd> toggle · <kbd>T</kbd> pages</div>
                    <div><ShortcutKeys keys={[SHORTCUT.mod, "F"]} /> find · <ShortcutKeys keys={[SHORTCUT.mod, "B"]} /> pages · <ShortcutKeys keys={[SHORTCUT.mod, SHORTCUT.alt, "B"]} /> notes of this PDF</div>
                    <div><kbd>[</kbd> <kbd>]</kbd> strip · <kbd>{SHORTCUT.chord(SHORTCUT.alt, "[")}</kbd> 1 pt · <kbd>{SHORTCUT.chord(SHORTCUT.alt, "↑")}</kbd> 1px · <kbd>{SHORTCUT.chord(SHORTCUT.mod, "[")}</kbd> ×3 · <kbd>↑</kbd> <kbd>↓</kbd> move</div>
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
              {/* Two Pages: the clear strip is one page wide. These cover the
                  rest of that row, including the facing page. */}
              <div className="focus-mask focus-mask-left" aria-hidden />
              <div className="focus-mask focus-mask-right" aria-hidden />
              {/* The hole is paint, plus the two resize borders. A press in the
                  middle reaches the page, so the text in the strip can be
                  selected; a right-click there is recognised on the stage
                  (`onStageContextMenu`). The strip is moved with `↑` / `↓` or
                  by parking it on another paragraph. */}
              <div className="focus-band">
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
              <ContextMenuSeparator />
              {/* The pen, from the band it is about to mark. The menu closes
                  first: the pen's stub follows the pointer, and a menu floating
                  over the page would sit in the way of the drag. */}
              <button
                type="button"
                className="strip-menu-item"
                role="menuitem"
                onClick={() => {
                  // The menu goes before the pen arms, so its measured brush is
                  // carried across first.
                  const brushPt = stripMenu.brushPt;
                  setStripMenu(null);
                  toggleHighlightPen(brushPt);
                }}
              >
                Toggle highlight
              </button>
              {/* A passage that has not been saved yet has no id to point at, so
                  the reference item appears once the band stands on a row. */}
              {displayStripId !== null && (
                <>
                  <ContextMenuSeparator />
                  <button
                    type="button"
                    className="strip-menu-item"
                    role="menuitem"
                    onClick={() => void copyDisplayStripReference()}
                  >
                    Copy as reference
                  </button>
                </>
              )}
              <div
                className={`strip-menu-note${stripSaveState === "error" ? " is-error" : ""}`}
                role="status"
              >
                {stripSaveMessage ?? menuCopy.hint}
              </div>
            </div>
          )}

          {/* The menu for a right-click outside the reading strip. It carries
              the same pen toggle as the band's menu, so the pen is one
              right-click away anywhere on the page. Portalled like the other
              menus, so it is placed in viewport coordinates. */}
          {pageMenu && (
            <PageContextMenu
              x={pageMenu.x}
              y={pageMenu.y}
              onToggleHighlight={() => {
                const brushPt = pageMenu.brushPt;
                setPageMenu(null);
                toggleHighlightPen(brushPt);
              }}
              onClose={() => setPageMenu(null)}
            />
          )}

          {/* One saved highlight's menu, opened by right-clicking the stroke while
              the pen is armed. `ContextMenu` portals it, so it sits above the stage
              at the pointer's viewport coordinates. */}
          {highlightMenu && (
            <HighlightContextMenu
              x={highlightMenu.x}
              y={highlightMenu.y}
              onDelete={() => {
                removeDocumentStroke(highlightMenu.page, highlightMenu.mark);
                setHighlightMenu(null);
              }}
              onClose={() => setHighlightMenu(null)}
            />
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
            onRevealNote={revealReferencedNote}
            onStatus={setSavedToast}
            pendingEditId={pendingNoteEditId}
            onPendingEditHandled={() => setPendingNoteEditId(null)}
            revealId={revealStripId}
            onRevealHandled={clearReveal}
            inNewWindow={isViewerWindow}
            // No bridge in the plain web build, so no pop-out there: a second
            // window would have nothing to talk to.
            // A viewer window is not the main window: popping a column out of it
            // would take over the notes window of the app that opened it.
            onDetach={isTauri() && !isViewerWindow ? () => void detachNotes() : undefined}
          />
        )}

      </div>

      </div>

      {view === "dashboard" && (
        <div className="dashboard">
          {/* The Dashboard's own chrome row, identical to the PDF view's: the
              window's second drag surface, and the container for the controls that
              act on the backend rather than on a page — the flow drawn, and the
              flow recorded. Both are app-level, which is why they live here now:
              the log is watched while the notes are browsed as well. */}
          <header className="toolbar" data-tauri-drag-region="deep">
            <div className="toolbar-cluster">
              <button
                className="ghost ghost-with-icon"
                onClick={() => void openEventStorming()}
                title="Open the event-storming diagram"
              >
                <Workflow size={14} aria-hidden />
                Flow
              </button>
              <button
                className={`ghost${eventLogOpen ? " active" : ""}`}
                onClick={toggleEventLog}
                aria-pressed={eventLogOpen}
                title="Event log — the backend's commands and events, beside the notes"
              >
                Events
              </button>
              {error && <span className="status-error">{error}</span>}
            </div>
          </header>
          <DashboardView
            onOpenDocument={(document) => void openDocumentFromNotes(document)}
            onOpenDocumentInNewWindow={
              isTauri() ? (document) => void openDocumentInNewWindow(document) : undefined
            }
            onOpenStrip={(document, strip) => void openStripFromNotes(document, strip)}
            onRevealNote={revealReferencedNote}
            onDocumentDeleted={(document) => void onDocumentDeleted(document)}
            onStatus={setSavedToast}
            pendingEditId={pendingNoteEditId}
            onPendingEditHandled={() => setPendingNoteEditId(null)}
          />
        </div>
      )}

      {/* Last column of the row, outermost on the right: whatever is on screen —
          the page, or the Dashboard's two panes — keeps the width the log leaves.
          Docked rather than laid over the view, so it never swallows a click meant
          for the surface beside it. */}
      <EventLogPanel
        paneRef={eventLogPaneRef}
        width={eventLogWidth}
        onResizeStart={onEventLogResize}
        open={eventLogOpen}
        onClose={() => setEventLogOpen(false)}
      />

      </div>

      {savedToast && (
        <div className="save-toast" role="status">
          {savedToast}
        </div>
      )}

      {pdfDropActive && (
        <div className="pdf-drop-veil" role="status">
          <p>Drop to open PDF</p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          void onHtmlFiles(files);
          event.target.value = "";
        }}
      />
    </div>
  );
}

export default App;
