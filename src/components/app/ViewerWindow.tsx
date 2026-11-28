/**
 * The viewer window: everything a window of this app is, once there is a document
 * to show or a dashboard to browse.
 *
 * This is the container the slices were built for. Its chrome no longer receives
 * state — the toolbar, the rail, the notes column, the event log and the overlays
 * each read the field they draw from the store, and the moves they make come from
 * `viewerCommands` — so what is left here is the part that genuinely has to be in
 * one place: the document session (a pdf.js object graph, which cannot be
 * serialised), the geometry measured from the DOM (the band, the scroll anchor,
 * the page under the pointer), and the effects that keep those two in step with
 * the store.
 *
 * That is still a lot of behaviour for one component, and the slices mark where it
 * should be cut next: a document session (`usePdfDocumentSession`, writing
 * documentSlice), a band controller (`useBand`, writing viewerSlice), an annotation
 * controller (writing the annotation state), and a strip-save controller. Each of
 * those already reads and writes one slice, so each can move out without the
 * others changing.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import "../../App.css";
import { TitleBar, type AppTab } from "../../components/TitleBar";
import { NO_ANNOTATIONS } from "../../components/pdf-page/PdfPageView";
import { useWindowChromeInset } from "../../useWindowChromeInset";
import { usePdfDropTarget } from "../../usePdfDropTarget";
import { useViewerShortcuts } from "../../useViewerShortcuts";
import { usePlaceRestore } from "../../components/pdf-page/usePlaceRestore";
import { useScrollAnchor, type ZoomAnchor } from "../../components/pdf-page/useScrollAnchor";
import { useAppMenu, type AppMenuCommands } from "../../useAppMenu";
import { useDocumentTitle } from "../../useDocumentTitle";
import { useViewerPrefs } from "../../useViewerPrefs";
import { useDockedColumnWidth } from "../../useDockedColumnWidth";
import { clamp } from "../../clamp";
import {
  contentLockAtPoint,
  pageElementAtPoint,
  pagePointAt,
  stageYFromContentLock,
  type ContentLock,
} from "../../pdfPageGeometry";
import { NotesColumn } from "../../components/notes/NotesColumn";
import { PdfToolbar } from "../../components/toolbar/PdfToolbar";
import {
  ViewerCommandsProvider,
  type ViewerCommands,
} from "../../components/app/viewerCommands";
import { PDFThumbnailRail } from "../thumbs/PDFThumbnailRail";
import { DashboardTab } from "../../components/dashboard/DashboardTab";
import { ViewerStage } from "../../components/stage/ViewerStage";
import { useHighlightPenSession } from "../../components/highlight/useHighlightPenSession";
import { useMenuDismiss } from "../../components/stage/useMenuDismiss";
import { useSaveToast } from "../../components/app/useSaveToast";
import { useNotesWindowBridge } from "../../components/notes/useNotesWindowBridge";
import { useNotesWindow } from "../../components/notes/useNotesWindow";
import { usePinGesture, type AnnotationDrag, type AnnotationPress } from "../../components/annotation/usePinGesture";
import { usePdfSearch } from "../../components/search/usePdfSearch";
import { searchCleared } from "../../store/slices/searchSlice";
import { useScrollerPlace } from "../../components/pdf-page/useScrollerPlace";
import { usePdfDocumentSession } from "../../components/pdf-page/usePdfDocumentSession";
import { useBandLayout, type DragLock } from "../../components/stage/useBandLayout";
import { useSavedStripStanding } from "../../components/stage/useSavedStripStanding";
import { useSelectionGuard } from "../../components/stage/useSelectionGuard";
import { useAnnotationLifecycle } from "../../components/annotation/useAnnotationLifecycle";
import { AnnotationMarkdownDialog } from "../../components/annotation/AnnotationMarkdownDialog";
import { useReferenceViewer } from "../../components/app/useReferenceViewer";
import { useStageZoom } from "../../components/stage/useStageZoom";
import { SaveToast } from "../../components/app/SaveToast";
import { PdfDropVeil } from "../../components/app/PdfDropVeil";
import { PdfFileInput } from "../../components/app/PdfFileInput";
import { EventLogPanel } from "../../components/EventLogPanel";
import {
  DEFAULT_NOTES_PANEL,
  MIN_NOTES_PANEL,
  maxNotesPanelWidth,
  resolveNotesPanelDrag,
  restoredNotesPanelWidth,
} from "../../notesPanel";
import {
  DEFAULT_EVENT_LOG_PANEL,
  MIN_EVENT_LOG_PANEL,
  maxEventLogPanelWidth,
  resolveEventLogPanelDrag,
  restoredEventLogPanelWidth,
} from "../../eventLogPanel";

import type { PdfLinkActions } from "../../pdf";
import { resolvePdfLinkDestination } from "../../pdfLinks";
import { openExternalLink } from "../../markdown/links";
import { findParagraphAt, paragraphBoxesFromTextLayer } from "../../paragraph";

import { placeStripPoint, STRIP_LINE_FRACTION } from "../../stripLine";
import { stripSelectBand } from "../../stripSelect";
import { zoomAnchorInArea } from "../../zoomAnchor";
import {
  fitZoom,
  pageHoleSpan,
  spreadStart,
  type PageLayout,
} from "../../pageLayout";
import { endDragOnBlur } from "../../windowDrag";
import {
  closedByEscape,
  type EscapeLayer,
} from "../../escapeDismiss";
import { dropRecent, loadPrefs, rememberPage, type RecentDoc } from "../../prefs";

import { useHistoryShortcuts } from "../../useHistoryShortcuts";
import { deletedOpenDocument } from "../../deletedOpenDocument";
import type {
  Annotation,
  AnnotationWithDocument,
  Note,
  NoteWithDocument,
  PdfDocumentListItem,
} from "../../types/dto";
import { apiErrorMessage } from "../../store/api/baseApi";
import { noteApi } from "../../store/api/noteApi";
import { annotationApi } from "../../store/api/annotationApi";
import { pdfDocumentApi } from "../../store/api/pdfDocumentApi";
import { appStateApi } from "../../store/api/appStateApi";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  dropVeilChanged,
  errorReported,
  recentsRestored,
  selectBusy,
  selectDocumentPath,
  selectRecents,
} from "../../store/slices/documentSlice";
import {
  eventLogOpened,
  eventLogToggled,
  notesDetachedChanged,
  notesPanelOpened,
  pendingEditChanged,
  selectEventLogOpen,
  selectNotesDetached,
  selectNotesOpen,
  selectPendingEditId,
  selectRevealStripId,
  selectToast,
  stripRevealed,
  toastShown,
} from "../../store/slices/panelsSlice";
import {
  annotationToolArmed,
  annotationToolToggled,
  focusModeChanged,
  highlightBrushChanged,
  highlightModeSet,
  highlightPenToggled,
  layoutChanged,
  pageShown,
  railToggled,
  selectViewer,
  stripHeightChanged,
  viewShown,
  zoomChanged,
} from "../../store/slices/viewerSlice";
import { store } from "../../store/store";
import {
  activePdfScrollOffset,
  goToNextPdfScroll,
  goToPreviousPdfScroll,
  settleActivePdfScroll,
} from "../../store/slices/appSlice";
import { parseViewerRequest } from "../../viewerRequest";
import {
  ViewerEvent,
  isTauri,
  openAppWindow,
  openDocumentViewerWindow,
  openReferenceViewerWindow,
  parseShowAnnotationRequest,
  parseShowNoteRequest,
  publishViewerDocument,
  referencePlacementFor,
  showAnnotationInViewerWindow,
  showNoteInViewerWindow,
  subscribe,
  type NotesContext,
  type ShowAnnotationRequest,
  type ShowNoteRequest,
  type StripBand,
} from "../../windowBridge";
import { savedStripGeometry } from "../../stripAnchor";
import { STRIP_STEP, stripScreenPx } from "../../stripMetrics";
import { brushUnderPoint } from "../../textBrush";
import { readingHoleTakesContextMenu } from "../../stripMenuHit";
import { copyTextToClipboard } from "../../clipboard";
import { annotationReferenceMarkdown } from "../../annotationReference";
import {
  annotationFontPt,
  annotationPageBoxes,
  annotationPointFrac,
  clampAnnotationPoint,
  type PageAnnotation,
} from "../../annotation";
import {
  highlightSessionId,
  parseDocumentHighlights,
  serializeDocumentHighlights,
  subscribeHighlightSession,
  type DocumentHighlight,
  type PagePoint,
  type StripHighlight,
} from "../../stripHighlight";
import { remarkedStrips } from "../../stripRemark";
import { MAX_ZOOM, MIN_ZOOM } from "../../viewerLimits";
import { NO_PAN, type PanPoint } from "../../zoomPan";

const APP_TITLE = "PDF Focus Viewer";

const MIN_STRIP = 10;
const MAX_STRIP = 640;
const DEFAULT_STRIP = 160;
const DEFAULT_BLUR = 5;

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

const initialPrefs = loadPrefs();

const PDF_PEN_SESSION = 0;




export function ViewerWindow() {
  const stageRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const focusOverlayRef = useRef<HTMLDivElement>(null);
  /** The area a `⌘`-drag is choosing, drawn over the veil; see `startStripSelect`. */
  const stripSelectRef = useRef<HTMLDivElement>(null);
  const parkedCenterYRef = useRef<number | null>(null);
  const contentLockRef = useRef<ContentLock | null>(null);
  const dragLockRef = useRef<DragLock | null>(null);
  const zoomRef = useRef(1);
  const stripHeightRef = useRef(DEFAULT_STRIP);
  const stripBlurRef = useRef(DEFAULT_BLUR);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const jumpingToPage = useRef<number | null>(null);
  /**
   * The offset the page column carries when the scroller cannot move far enough to
   * hold the word a zoom was centred on — a sheet smaller than the page area, or
   * the document's first page. See `zoomPan`.
   */
  const panRef = useRef<PanPoint>(NO_PAN);
  /** Bumped on every link click, so a slow destination cannot land after a newer one. */
  const pdfLinkSeq = useRef(0);
  const pdfLinkActionsRef = useRef<PdfLinkActions>({
    goToDestination: () => { },
    executeNamedAction: () => { },
    openExternal: () => { },
  });
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);
  /**
   * Set when the next zoom change is the viewer's answer to a column opening or
   * closing, not the reader's own zoom. Only that change has to repaint the
   * scroller afterwards; see the correction effect.
   */
  const layoutZoomRef = useRef(false);
  const recentsRef = useRef(initialPrefs.recents);
  const currentPageRef = useRef(1);
  const pageLayoutRef = useRef<PageLayout>(initialPrefs.pageLayout);
  /**
   * Where the page the reader is on sat, measured before a layout change.
   * The next paint puts that page back, so switching Single / Two Pages does
   * not jump them to the top of the document or change the zoom.
   */
  const layoutAnchorRef = useRef<{ page: number; top: number; left: number } | null>(null);
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
  /** Page point a just-opened saved strip wants on the band line, if any. */
  const openSearchRef = useRef<() => void>(() => { });
  const stepHitRef = useRef<(delta: number) => void>(() => { });
  const openWithPickerRef = useRef<() => void>(() => { });
  const openAppWindowRef = useRef<() => void>(() => { });
  const nudgeFocusStripRef = useRef<(deltaY: number) => void>(() => { });

  /** Needed to hand the other window's invalidations to this window's cache. */
  const dispatch = useAppDispatch();

  /* The setters the viewer's own logic already spoke: each one is a reducer call,
     so the rules (what a strip height may be, what arming the pen does to the
     annotation tool) live in the slice rather than here. */
  const setZoom = useCallback((next: number) => dispatch(zoomChanged(next)), [dispatch]);
  const setCurrentPage = useCallback((page: number) => dispatch(pageShown(page)), [dispatch]);
  const setPageLayout = useCallback((next: PageLayout) => dispatch(layoutChanged(next)), [dispatch]);
  const setStripHeight = useCallback((pt: number) => dispatch(stripHeightChanged(pt)), [dispatch]);
  const setFocusMode = useCallback((on: boolean) => dispatch(focusModeChanged(on)), [dispatch]);
  const setHighlightMode = useCallback((on: boolean) => dispatch(highlightModeSet(on)), [dispatch]);
  const setHighlightBrush = useCallback(
    (pt: number) => dispatch(highlightBrushChanged(pt)),
    [dispatch],
  );
  const setAnnotationMode = useCallback(
    (armed: boolean) => dispatch(annotationToolArmed(armed)),
    [dispatch],
  );
  const setView = useCallback((next: AppTab) => dispatch(viewShown(next)), [dispatch]);

  /* The document's chrome state is the document slice's, and the receipts are the
     panels slice's, for the same reason: the title strip, the toolbar, the notes
     column and the toast all show them, and none of them is the other's parent. */
  const recents = useAppSelector(selectRecents);
  const setRecents = useCallback(
    (update: (current: RecentDoc[]) => RecentDoc[]) => {
      const next = update(store.getState().document.recents);
      dispatch(recentsRestored(next));
    },
    [dispatch],
  );
  const busy = useAppSelector(selectBusy);
  const setError = useCallback((message: string | null) => dispatch(errorReported(message)), [dispatch]);
  const openPath = useAppSelector(selectDocumentPath);
  /**
   * The same path for the listeners below, which outlive any one render.
   *
   * A window that is asked to show a passage must answer with the document it has
   * open *now*: its own document can have been changed since the listener was
   * registered, and a request for another PDF has to be dropped rather than
   * obeyed.
   */
  const openPathRef = useRef<string | null>(openPath);
  openPathRef.current = openPath;
  const savedToast = useAppSelector(selectToast);
  const setSavedToast = useCallback(
    (message: string | null) => dispatch(toastShown(message)),
    [dispatch],
  );

  /* The docked columns, and the strip a badge asked to see: the panels slice's,
     so the column, the toolbar's toggle and the page area that gives up the width
     can each read the part they show. */
  const eventLogOpen = useAppSelector(selectEventLogOpen);
  const setEventLogOpen = useCallback((open: boolean) => dispatch(eventLogOpened(open)), [dispatch]);
  const notesPanelOpen = useAppSelector(selectNotesOpen);
  const setNotesPanelOpen = useCallback((open: boolean) => dispatch(notesPanelOpened(open)), [dispatch]);
  const notesDetached = useAppSelector(selectNotesDetached);
  const setNotesDetached = useCallback((detached: boolean) => dispatch(notesDetachedChanged(detached)), [dispatch]);
  const revealStripId = useAppSelector(selectRevealStripId);
  const setRevealStripId = useCallback((id: number | null) => dispatch(stripRevealed(id)), [dispatch]);
  const pendingNoteEditId = useAppSelector(selectPendingEditId);
  const setPendingNoteEditId = useCallback(
    (id: number | null) => dispatch(pendingEditChanged(id)),
    [dispatch],
  );

  /**
   * A document is being opened or closed: everything the stage was holding for
   * the previous one goes. The band's lock and its screen place, the drag in
   * flight, the band's menu, a page's menu, the save's receipt and the strip the
   * band was standing on all describe a document that is no longer on screen.
   */
  const resetStageForDocument = useCallback(() => {
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
    setDisplayStripId(null);
  }, [setPendingNoteEditId, setRevealStripId]);

  /**
   * The open document, and everything about opening one.
   *
   * The document itself cannot live in the store (a pdf.js object graph is not
   * serialisable), so the session keeps it and writes the parts the chrome shows
   * into `documentSlice`. What the stage owns — the band's lock, its menu, a
   * page's menu — is put away through `onOpened` / `onClosed`, which is the one
   * thing the session cannot know about.
   */
  const session = usePdfDocumentSession({
    layoutRef: pageLayoutRef,
    zoomRef,
    scrollerRef,
    fileInputRef,
    clearSearch: () => dispatch(searchCleared()),
    onOpened: () => resetStageForDocument(),
    onClosed: () => resetStageForDocument(),
    setZoom,
  });

  const pdf = session.pdf;
  const pdfRef = session.documentRef;
  const openDocRef = session.openedFile;
  const pendingPageRestore = session.pendingPage;
  const pendingStripRestore = session.pendingStrip;
  const skipRestoreUntilZoom = session.skipRestoreUntilZoom;
  const restoreTick = session.restoreTick;
  const { openWithPicker, openViaLibrary, closePdf, openFiles } = session;

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
  /**
   * What this window starts at: the saved preferences, and — in a window opened
   * on one passage — the single page and folded rail that window was opened for.
   * Applied once; from then on the store is the viewer's own.
   */
  /** Opened on one passage: there is a note to put the reading strip on. */
  const isReferenceViewer = viewerRequest !== null;

  /**
   * The reading view's state lives in the store (`viewerSlice`): the toolbar, the
   * rail, the band and the pages each read the field they draw, so a change to one
   * of them re-renders that component instead of the whole viewer. What stays here
   * is the document (not serialisable) and the geometry measured from the DOM.
   */
  const viewer = useAppSelector(selectViewer);
  const focusMode = viewer.focusMode;
  /**
   * Read here because the geometry below is measured against them — the pages
   * are scaled by the zoom, the rail takes its width out of the row, and the veil
   * is drawn at the blur. They are read from the store so that the toolbar, the
   * band and the rail do not have to be told about them.
   */
  const zoom = viewer.zoom;
  const railWidth = viewer.railWidth;
  const stripBlur = viewer.stripBlur;
  /** The toolbar pen. While it is down, a drag on any page of the open PDF lays a stroke. */
  const highlightMode = viewer.highlightMode;
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
  const showThumbs = viewer.railOpen;
  const pageLayout = viewer.pageLayout;
  const currentPage = viewer.currentPage;
  const stripHeight = viewer.stripHeight;
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
   *
   * `spot` is where the press fell on the page, in the page's own points — the same
   * measurement the page's menu makes, because the band carries the same "Add
   * annotation" item. It is null when the band stands over the gap between two
   * pages, and then there is nothing there to pin to.
   */
  const [stripMenu, setStripMenu] = useState<{
    x: number;
    y: number;
    brushPt: number | null;
    spot: { page: number; point: PagePoint } | null;
  } | null>(null);
  /**
   * The page's menu, for a right-click that did not land in the reading strip:
   * the same pen toggle the strip's menu carries, and the place the press landed.
   *
   * The place is measured while the menu opens — the pointer is on the menu by the
   * time an item is clicked — which is what lets "Add annotation here" pin a note
   * to the words the right-click was about.
   */
  const [pageMenu, setPageMenu] = useState<{
    x: number;
    y: number;
    brushPt: number | null;
    page: number;
    point: { x: number; y: number };
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
  /**
   * The annotation tool, on or off.
   *
   * Armed, a click on any page places a pin where it landed and opens the editor
   * for it. It is a tool like the highlight pen and shares its rule: only one of
   * them is ever down, so arming one puts the other away.
   */
  const annotationMode = viewer.annotationMode;
  /**
   * The pin being written, if any.
   *
   * `mode: "new"` is a click on bare paper: `point` is where the pin will stand,
   * and no row exists yet. `mode: "edit"` is a press on a saved pin: `id` names the
   * row and `point` is only remembered so a save reports where it is.
   */
  const [annotationDraft, setAnnotationDraft] = useState<{
    mode: "new" | "edit";
    id: number | null;
    page: number;
    point: { x: number; y: number };
    x: number;
    y: number;
    text: string;
  } | null>(null);
  /** Which pin's own menu is open, and where the press that asked for it was. */
  const [annotationMenu, setAnnotationMenu] = useState<{
    annotation: Annotation;
    x: number;
    y: number;
  } | null>(null);
  /**
   * The pin whose writing is open in the markdown popup, if any.
   *
   * This is the menu's **Edit with preview**, not the in-place editor: the popup
   * is the notes column's dialog (`AnnotationMarkdownDialog`), a modal over the
   * whole window, so it is held here rather than by the page. Only one row is in
   * it at a time, and the two ways of writing a pin are never open together.
   */
  const [previewAnnotation, setPreviewAnnotation] = useState<Annotation | null>(null);
  /**
   * The pin in the reader's hand, while it is being dragged.
   *
   * One gesture: press the pin, move, release — and the release places it. There is
   * no second step, so there is no bar and no mode to enter from a menu; `Escape` is
   * the only way out that writes nothing.
   *
   * `target` is where the drag has left the piece, `offset` is where inside the pin
   * the press landed (in PDF points, so the piece does not jump into the hand), and
   * `saving` is the write the release started.
   */
  const [annotationMove, setAnnotationMove] = useState<AnnotationDrag | null>(null);
  /** The press on a pin that may still become a drag; see `usePinGesture`. */
  const [annotationPress, setAnnotationPress] = useState<AnnotationPress | null>(null);
  /**
   * The size under the hand while a pin's type slider is being dragged.
   *
   * The page has to follow the track — the reader is choosing how the writing looks,
   * and a preview that only appears after letting go is a guess. The row is written
   * **once**, on the release, so one drag is one undo step; the draft is dropped as
   * soon as the row carries the same number, so nothing snaps back in between.
   */
  const [annotationFontDraft, setAnnotationFontDraft] = useState<{
    id: number;
    fontPt: number;
  } | null>(null);
  /**
   * The move as the press handlers see it. Those handlers are built once per
   * render of the page column, and a press that arrives mid-render must still know
   * that the viewer is in the middle of a move.
   */
  const annotationMoveRef = useRef(annotationMove);
  annotationMoveRef.current = annotationMove;
  /** The pin a reference just scrolled to, ringed for a moment so it can be found. */
  const [foundAnnotationId, setFoundAnnotationId] = useState<number | null>(null);
  /** A pin write in flight, and the reason the last one failed. */
  const [annotationSaving, setAnnotationSaving] = useState(false);
  const [annotationError, setAnnotationError] = useState<string | null>(null);
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
  /** Which of the two top-level views is showing. */
  const view = viewer.view;
  // The note dialog's veil starts under the title strip and the toolbar, which
  // are the window's drag handle. Measured here because both rows live in this
  // window, and the Dashboard swaps the toolbar for another of a different height.
  useWindowChromeInset();
  /**
   * The docked event log: what the backend recorded, watched beside the page.
   *
   * A column of its own in the same row as the notes column — it takes width from
   * the page rather than covering it, so the log can be watched *while* the viewer
   * is used. It obeys the same rules (`eventLogPanel.ts`), remembers its width the
   * same way. Escape closes it only once the reading strip is off; while the
   * strip is on, that press turns the strip off and leaves the log up.
   */
  const eventLogPaneRef = useRef<HTMLElement | null>(null);
  /** The toolbar's Events button: raise the log column, or put it away. */
  const toggleEventLog = useCallback(() => {
    dispatch(eventLogToggled());
  }, [dispatch]);

  /** The open file's path as state, for the components that need to resolve it. */
  /** Just-saved strip whose card should open its remark field. */
  /**
   * The docked "Notes of this PDF" panel: the open document's strips, beside the
   * page rather than instead of it. Independent of the top-level `view` tab,
   * because both can be useful at once — read on the left, notes on the right.
   */
  /**
   * The notes column lives in its own window.
   *
   * While true the inline column is not rendered and `notesPanelOpen` stays
   * false, so the toolbar toggle reads as "raise the column" rather than as one
   * that is already on screen. Closing the window docks it back, open.
   */
  const notesPaneRef = useRef<HTMLElement | null>(null);
  /**
   * The strip a note badge asked the notes column to show. It is an id rather than
   * a "scroll now" command because the card may not exist yet — its folder can be
   * closed, or its rows still loading — so `StripList` is the one that waits for
   * it and then puts it on the list's line.
   */

  const [resolveDocument] = pdfDocumentApi.endpoints.getOrCreateDocument.useLazyQuery();
  const [createStrip] = noteApi.endpoints.createStrip.useMutation();
  const [updateStrip] = noteApi.endpoints.updateStrip.useMutation();
  /** The note a reference viewer is about; skipped in every other window. */
  const { data: referenceStrip } = noteApi.endpoints.getStrip.useQuery(
    viewerRequest?.noteId ?? 0,
    { skip: viewerRequest?.noteId == null },
  );
  /** The annotation this window was opened on, when it was opened on one. */
  const { data: referenceAnnotation } = annotationApi.endpoints.getAnnotation.useQuery(
    viewerRequest?.annotationId ?? 0,
    { skip: viewerRequest?.annotationId == null },
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
  /**
   * The annotations pinned to the open document.
   *
   * A pin belongs to the PDF, not to a strip, so it is read once per document and
   * shown on whichever page it names — in this window and in any other one, which
   * is what the tag type and the cache-stale announcement take care of.
   */
  const { data: documentAnnotations = [] } = annotationApi.endpoints.listDocumentAnnotations.useQuery(
    openDocumentId ?? 0,
    { skip: openDocumentId == null },
  );
  /**
   * The pins of each page, in a map that only changes when the rows do.
   *
   * The page views are memoised, and a fresh array on every render would re-render
   * every page in the document whenever a toast or a page tick landed. The empty
   * list is one constant for the pages that have no pins at all.
   */
  const annotationsByPage = useMemo(() => {
    const byPage = new Map<number, PageAnnotation[]>();
    for (const annotation of documentAnnotations) {
      const list = byPage.get(annotation.page_number) ?? [];
      list.push({
        id: annotation.id,
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        font_size: annotation.font_size,
        text: annotation.text,
      });
      byPage.set(annotation.page_number, list);
    }
    return byPage;
  }, [documentAnnotations]);
  /**
   * The pins a page draws.
   *
   * Two pins are drawn from a gesture rather than from their row: the one being
   * moved, which stands where the drag has left it, and the one whose type is being
   * dragged, which is drawn at the size under the hand. Both are the same idea — the
   * reader sees the change as they make it — and both are written once, on release.
   * A pin dragged off its page leaves that page's list and appears on the one it was
   * dropped on.
   */
  const annotationsOfPage = useCallback(
    (page: number) => {
      const base = annotationsByPage.get(page) ?? NO_ANNOTATIONS;
      const moving = annotationMove;
      let placed = base;
      if (moving?.target) {
        const { annotation, target } = moving;
        if (target.page !== page) {
          placed =
            annotation.page_number === page
              ? base.filter((pin) => pin.id !== annotation.id)
              : base;
        } else {
          const moved = {
            id: annotation.id,
            x: target.point.x,
            y: target.point.y,
            width: annotation.width,
            font_size: annotation.font_size,
            text: annotation.text,
          };
          placed =
            annotation.page_number !== page
              ? [...base, moved]
              : base.map((pin) => (pin.id === annotation.id ? moved : pin));
        }
      }
      const typed = annotationFontDraft;
      if (!typed) return placed;
      return placed.map((pin) => (pin.id === typed.id ? { ...pin, font_size: typed.fontPt } : pin));
    },
    [annotationMove, annotationFontDraft, annotationsByPage],
  );
  const [createAnnotation] = annotationApi.endpoints.createAnnotation.useMutation();
  const [updateAnnotation] = annotationApi.endpoints.updateAnnotation.useMutation();
  const [deleteAnnotation] = annotationApi.endpoints.deleteAnnotation.useMutation();

  /**
   * The two writes an edit *inside* an annotation's writing makes.
   *
   * Dragging a picture's edge or a nested note's edge rewrites the markdown, and the
   * row takes the new markdown through the same optimistic patch a retype uses.
   */
  const writeAnnotationText = useCallback(
    (annotation: PageAnnotation, text: string) => {
      const row = documentAnnotations.find((candidate) => candidate.id === annotation.id);
      if (!row || row.text === text) return;
      void updateAnnotation({
        id: row.id,
        documentId: row.pdf_document_id,
        text,
      });
    },
    [documentAnnotations, updateAnnotation],
  );

  /**
   * The reader let go of the type slider: keep the size they landed on.
   *
   * The page has been drawing the draft since the press, so the write is the same
   * number the reader already sees — one row written once, one undo step, and no
   * snap when the draft is dropped.
   */
  const writeAnnotationFontSize = useCallback(
    (annotation: PageAnnotation, fontPt: number) => {
      // The gesture is over either way: the page goes back to drawing the row, which
      // the write patches to this same number before the request leaves.
      setAnnotationFontDraft(null);
      const row = documentAnnotations.find((candidate) => candidate.id === annotation.id);
      const next = Math.round(annotationFontPt(fontPt) * 100) / 100;
      if (!row || row.font_size === next) return;
      void updateAnnotation({
        id: row.id,
        documentId: row.pdf_document_id,
        font_size: next,
      });
    },
    [documentAnnotations, updateAnnotation],
  );

  /** The reader dragged the content's edge: keep the width they chose, per row. */
  const writeAnnotationWidth = useCallback(
    (annotation: PageAnnotation, width: number) => {
      const row = documentAnnotations.find((candidate) => candidate.id === annotation.id);
      if (!row) return;
      void updateAnnotation({
        id: row.id,
        documentId: row.pdf_document_id,
        width,
      });
    },
    [documentAnnotations, updateAnnotation],
  );

  const { data: savedStrips } = noteApi.endpoints.listStrips.useQuery(
    { pdf_document_id: openDocumentId ?? 0 },
    { skip: openDocumentId == null },
  );
  /** One badge per saved strip with a remark, in draw order. */
  const remarked = useMemo(() => remarkedStrips(savedStrips ?? []), [savedStrips]);
  /** The band's row can be deleted under it; that closes the band (see the hook). */
  useSavedStripStanding({
    standingOn: displayStripId,
    strips: savedStrips,
    onDeleted: () => {
      setDisplayStripId(null);
      setFocusMode(false);
      setSavedToast("That note was deleted, so the reading strip is closed.");
    },
  });
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
  /* ── annotations: the pins the document owns ─────────────────────────────── */

  /**
   * The annotation tool, on or off.
   *
   * `A`, the toolbar's Annotate button and the page's own menu all mean the same
   * thing — take the tool or put it down. Armed, one click on a page pins a piece
   * of text where it landed: the point is the click, and the editor opens on it.
   * The pins belong to the document, so they show in the viewer, in every note
   * card's preview of that page, and in every window.
   *
   * Only one tool is down at a time: arming this one puts the highlight pen away,
   * and putting the highlight pen down (anywhere in the app) puts this one away.
   * Refused with no document row to own the pin: a PDF opened from bytes has no
   * row a mark could belong to, which is the same rule the strokes follow.
   */
  const toggleAnnotationTool = useCallback(() => {
    if (!pdfRef.current) return;
    if (openDocumentId == null) {
      setSavedToast("This PDF is not in the library yet, so it cannot hold annotations.");
      return;
    }
    setAnnotationDraft(null);
    setAnnotationMenu(null);
    setAnnotationMove(null);
    setHighlightMode(false);
    dispatch(annotationToolToggled());
  }, [openDocumentId]);
  const toggleAnnotationToolRef = useRef(toggleAnnotationTool);
  toggleAnnotationToolRef.current = toggleAnnotationTool;

  /** Open the editor for a press on bare paper, with the tool armed. */
  const beginAnnotation = useCallback(
    (page: number, point: { x: number; y: number }, clientX: number, clientY: number) => {
      setAnnotationMenu(null);
      // Starting something else ends a move: one gesture at a time, and a ghost
      // under an editor would be a pin with two places.
      setAnnotationMove(null);
      setAnnotationError(null);
      setAnnotationDraft({
        mode: "new",
        id: null,
        page,
        point,
        x: clientX,
        y: clientY,
        text: "",
      });
    },
    [],
  );

  /**
   * Open the writing of a saved pin for editing, where it stands.
   *
   * The editor is not placed here: the page draws it at the annotation's own corner
   * (`AnnotationInlineEditor`), so all that is decided is *which* pin is being changed.
   * The coordinates are the press's, kept for the report a save makes.
   *
   * `false` is "there was nothing to open" — a move is in the air, or the page leaves
   * the pin no room to write beside (which is also when it draws no writing), so the
   * press that asked can fall back to the page's own meaning.
   */
  const openAnnotationEditor = useCallback(
    (annotation: PageAnnotation, page: number, clientX: number, clientY: number): boolean => {
      // A press while a move is live is the move's, not an edit's.
      if (annotationMoveRef.current) return false;
      const pageWidth = pdfRef.current?.pages.find((candidate) => candidate.index === page)?.width;
      if (pageWidth == null || !annotationPageBoxes(annotation, { width: pageWidth }).card) {
        return false;
      }
      setAnnotationMenu(null);
      setAnnotationError(null);
      // A second press on the pin already being changed keeps that draft: it is the
      // same row and the same words, and a fresh object would rebuild the editor
      // under the reader's hand (the page draws it, keyed by that identity).
      setAnnotationDraft((current) =>
        current?.mode === "edit" && current.id === annotation.id
          ? current
          : {
            mode: "edit",
            id: annotation.id,
            page,
            point: { x: annotation.x, y: annotation.y },
            x: clientX,
            y: clientY,
            text: annotation.text,
          },
      );
      return true;
    },
    [],
  );

  /**
   * A double-press that landed on a pin is about that pin, not the paragraph behind it.
   *
   * This is the whole of the priority the gesture needed: `parkFocusAtPoint` asks here
   * first, so the same double-click opens the annotation's writing for editing where it
   * stands instead of framing the passage under the pointer with the reading band. The
   * pin and its writing are both targets — the row is named on the piece
   * (`data-annotation-id`), so one lookup answers for either.
   *
   * `true` means the press has been answered and the band must be left alone.
   */
  const editAnnotationAtPress = useCallback(
    (clientX: number, clientY: number, target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      const piece = target.closest<HTMLElement>("[data-annotation-id]");
      if (!piece) return false;
      const id = Number(piece.dataset.annotationId);
      if (!Number.isFinite(id)) return false;
      const row = documentAnnotations.find((candidate) => candidate.id === id);
      if (!row) return false;
      return openAnnotationEditor(row, row.page_number, clientX, clientY);
    },
    [documentAnnotations, openAnnotationEditor],
  );

  /**
   * Open a saved pin's writing in the markdown popup — the menu's **Edit with preview**.
   *
   * A pin's words are markdown, and the page only shows the rendered result, so
   * rewriting them is done where the source and the preview are side by side: the
   * popup the notes column uses (`AnnotationMarkdownDialog`), minus the page band
   * — a pin is pinned to a point, not to a strip, so there is nothing to read the
   * writing against.
   *
   * Nothing is placed and nothing is measured: the popup is a dialog over the
   * window, not an overlay of the page, so the page needs no room for it and the
   * only decision is which row it holds. The in-place editor gives way — one draft
   * at a time — and the pin's menu is the press that asked, so it closes with it.
   */
  const openAnnotationPreview = useCallback((annotation: Annotation) => {
    setAnnotationMenu(null);
    setAnnotationDraft(null);
    setAnnotationError(null);
    setPreviewAnnotation(annotation);
  }, []);

  /**
   * Write the pin being edited.
   *
   * A new pin is the one write that creates a row: everything about it is decided
   * here — the page, the point and the text. An edit rewrites the text of a row
   * that already exists, and its place stays where it was. The editor closes only
   * once the write has landed, so a refusal leaves the text where the reader can
   * read the reason and try again.
   */
  const saveAnnotationDraft = useCallback(
    async (text: string) => {
      const draft = annotationDraft;
      if (!draft) return;
      if (openDocumentId == null) {
        setAnnotationError("This PDF cannot hold annotations.");
        return;
      }
      setAnnotationSaving(true);
      setAnnotationError(null);
      try {
        if (draft.mode === "new") {
          await createAnnotation({
            documentId: openDocumentId,
            page_number: draft.page,
            x: draft.point.x,
            y: draft.point.y,
            text,
          }).unwrap();
        } else if (draft.id !== null) {
          await updateAnnotation({ id: draft.id, documentId: openDocumentId, text }).unwrap();
        }
        // Only *this* draft is closed: a press somewhere else while the write was in
        // the air may have opened another pin's editor, and closing the draft by
        // stamp would have taken that one down with it.
        setAnnotationDraft((current) => (current === draft ? null : current));
      } catch (cause) {
        setAnnotationError(apiErrorMessage(cause) || "Could not save this annotation.");
      } finally {
        setAnnotationSaving(false);
      }
    },
    [annotationDraft, createAnnotation, openDocumentId, updateAnnotation],
  );

  /** Leave the pin being edited as it was: the row is untouched. */
  const cancelAnnotationDraft = useCallback(() => {
    setAnnotationDraft(null);
    setAnnotationError(null);
  }, []);

  /**
   * Write the popup's markdown onto its row.
   *
   * The same rule the in-place editor follows: a pin with no words is a mark with
   * nothing to read, so empty writing is refused rather than stored — the popup
   * stays open on it and says why. It closes only once the write has landed, so a
   * refusal leaves the text where the reader can read the reason and try again.
   */
  const saveAnnotationPreview = useCallback(
    async (markdown: string) => {
      const row = previewAnnotation;
      if (!row) return;
      if (openDocumentId == null) {
        setAnnotationError("This PDF cannot hold annotations.");
        return;
      }
      const text = markdown.trim();
      if (!text) {
        setAnnotationError("An annotation needs some words.");
        return;
      }
      setAnnotationSaving(true);
      setAnnotationError(null);
      try {
        await updateAnnotation({ id: row.id, documentId: openDocumentId, text }).unwrap();
        // Only *this* popup is closed: the write may have been in the air while
        // another pin was opened, and closing by stamp would take that one down.
        setPreviewAnnotation((current) => (current === row ? null : current));
      } catch (cause) {
        setAnnotationError(apiErrorMessage(cause) || "Could not save this annotation.");
      } finally {
        setAnnotationSaving(false);
      }
    },
    [openDocumentId, previewAnnotation, updateAnnotation],
  );

  /** Leave the pin the popup is holding as it was: the row is untouched. */
  const cancelAnnotationPreview = useCallback(() => {
    // A write in flight is not cancelled by its own dialog: the row is already on
    // its way, and the popup stays until it lands or is refused.
    if (annotationSaving) return;
    setPreviewAnnotation(null);
    setAnnotationError(null);
  }, [annotationSaving]);

  /** A draft size is about a row of the open document; another document ends it. */
  useEffect(() => {
    setAnnotationFontDraft(null);
  }, [openDocumentId]);

  /** Remove one pin. `⌘Z` puts it back under the same id, references included. */
  const removeAnnotation = useCallback(
    async (id: number) => {
      setAnnotationDraft((draft) => (draft?.id === id ? null : draft));
      setPreviewAnnotation((row) => (row?.id === id ? null : row));
      setAnnotationMenu(null);
      try {
        await deleteAnnotation(id).unwrap();
        setSavedToast("Annotation deleted.");
      } catch (cause) {
        setSavedToast(apiErrorMessage(cause) || "Could not delete the annotation.");
      }
    },
    [deleteAnnotation],
  );

  /**
   * Put the pin where the drag left it.
   *
   * The release *is* the confirmation: one write of the page and the point, one undo
   * step, and the piece stays where the hand left it. A drag that ends where the pin
   * already stands writes nothing, so a grab that comes to nothing leaves the
   * history alone. The piece is kept at the dragged place until the write answers, so
   * it does not flash back to its old spot while the round trip is in the air.
   */
  const commitAnnotationMove = useCallback(
    async (moving: AnnotationDrag | null) => {
      if (!moving) return;
      if (!moving.target) {
        setAnnotationMove(null);
        return;
      }
      const { page, point } = moving.target;
      // A placement is two finite points and a page: a half-read drop is not a call
      // to make, and a body with nothing in it only comes back as a refusal.
      if (!Number.isInteger(page) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        setAnnotationMove(null);
        setSavedToast("Could not read where the annotation was dropped.");
        return;
      }
      const same =
        page === moving.annotation.page_number &&
        point.x === moving.annotation.x &&
        point.y === moving.annotation.y;
      if (same) {
        setAnnotationMove(null);
        return;
      }
      setAnnotationMove((current) => (current ? { ...current, saving: true } : current));
      try {
        await updateAnnotation({
          id: moving.annotation.id,
          // The list the pin is drawn from: the write is patched into it before the
          // request leaves, so the piece is already at the dropped place.
          documentId: moving.annotation.pdf_document_id,
          page_number: page,
          x: point.x,
          y: point.y,
        }).unwrap();
        setAnnotationMove(null);
      } catch (cause) {
        // The row is unchanged, so the pin belongs back on it.
        setAnnotationMove(null);
        setSavedToast(apiErrorMessage(cause) || "Could not move the annotation.");
      }
    },
    [updateAnnotation],
  );

  /**
   * Grab a pin that is already in a drag: the press keeps the hand's offset.
   *
   * Without a page under the press there is no offset to keep, and a pin placed at
   * the raw pointer would jump out of the hand that grabbed it.
   */
  const grabAnnotationMove = useCallback((clientX: number, clientY: number) => {
    const hit = pagePointAt(clientX, clientY);
    if (!hit) return;
    setAnnotationMove((current) => {
      if (!current || current.saving) return current;
      const placed = current.target ?? {
        page: current.annotation.page_number,
        point: { x: current.annotation.x, y: current.annotation.y },
      };
      return {
        ...current,
        dragging: true,
        offset:
          hit.page === placed.page
            ? { x: placed.point.x - hit.point.x, y: placed.point.y - hit.point.y }
            : { x: 0, y: 0 },
      };
    });
  }, []);

  /**
   * Follow the pointer while a pin is in the hand.
   *
   * The page under the pointer is found by asking what is drawn there, so a pin can
   * be carried to the page beside it as easily as across one. Off the paper the last
   * place stands: a pointer in the dark beside a page is not a place to put a pin,
   * and clearing it would make the pin blink out on the way past a gap.
   *
   * Letting go is what places it (`commitAnnotationMove`): the release is the
   * confirmation, so there is no bar to answer and no mode left behind.
   */

  /**
   * A left press on a pin, before it is anything.
   *
   * The pin is a handle by default, so a press is always the possible start of a
   * drag — but only a possible one. Held still and released, it is a click on a mark,
   * which does nothing; the drag begins when the pointer travels. That distinction
   * is what keeps a plain click from leaving a pin looking half-moved.
   */

  /**
   * Remember the press. The row is looked up by id because a move writes the row,
   * not the page's copy of it.
   */
  const pressAnnotation = useCallback(
    (annotation: PageAnnotation, clientX: number, clientY: number) => {
      if (annotationMoveRef.current?.saving) return;
      const row = documentAnnotations.find((candidate) => candidate.id === annotation.id);
      if (!row) return;
      setAnnotationPress({ annotation: row, x: clientX, y: clientY });
    },
    [documentAnnotations],
  );

  /**
   * The press has travelled: grab the pin where it stands.
   *
   * The offset is measured from the press, not from the pointer now, so the piece
   * does not jump by the few pixels it took to prove the intent. Starting a drag
   * ends the other annotations gestures the same way the right-click menu's **Move**
   * does: one thing at a time.
   */
  const startAnnotationDrag = useCallback(
    (annotation: Annotation, clientX: number, clientY: number) => {
      const hit = pagePointAt(clientX, clientY);
      setAnnotationMenu(null);
      setAnnotationDraft(null);
      setAnnotationMode(false);
      setAnnotationError(null);
      setAnnotationMove({
        annotation,
        target: null,
        offset: hit
          ? { x: annotation.x - hit.point.x, y: annotation.y - hit.point.y }
          : { x: 0, y: 0 },
        dragging: true,
        saving: false,
      });
    },
    [],
  );


  /** `[annotation:<id>]` on the clipboard, for pasting into a note's markdown. */
  const copyAnnotationReference = useCallback(async (id: number) => {
    setAnnotationMenu(null);
    const reference = annotationReferenceMarkdown(id);
    const copied = await copyTextToClipboard(reference);
    setSavedToast(
      copied
        ? `Copied ${reference} — paste it into a note to point at this annotation.`
        : "Could not copy the reference to the clipboard.",
    );
  }, []);

  /** Put the annotation tool away and drop every in-flight edit, menu and move. */
  const resetAnnotations = useCallback(() => {
    setAnnotationMode(false);
    setAnnotationDraft(null);
    setAnnotationMenu(null);
    setAnnotationMove(null);
    setAnnotationPress(null);
    setFoundAnnotationId(null);
    // The popup writes a row of the document that is going away, so it goes with
    // the rest of that document's surfaces.
    setPreviewAnnotation(null);
    setAnnotationError(null);
  }, []);

  /**
   * The pin's gesture: the press that may become a drag, and the hand carrying the
   * pin while it is one. The release places it — `commitAnnotationMove` is the write.
   */
  const { movingId } = usePinGesture({
    move: annotationMove,
    setMove: setAnnotationMove,
    moveRef: annotationMoveRef,
    press: annotationPress,
    setPress: setAnnotationPress,
    commit: (moving) => void commitAnnotationMove(moving),
    grab: grabAnnotationMove,
    start: startAnnotationDrag,
  });

  /**
   * The tool's life: another document puts it away, and a pin a reference found is
   * ringed once.
   */
  useAnnotationLifecycle({
    documentPath: openPath,
    reset: resetAnnotations,
    foundId: foundAnnotationId,
    clearFound: () => setFoundAnnotationId(null),
  });

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
    const wasDown = store.getState().viewer.highlightMode;
    dispatch(highlightPenToggled(textBrushPt));
    if (wasDown) return;
    // Arming the pen puts the other tool away; its half-written pieces go with it.
    setAnnotationDraft(null);
    setAnnotationMenu(null);
  }, [dispatch, pdfPenBlocked]);
  const toggleHighlightPenRef = useRef(toggleHighlightPen);
  toggleHighlightPenRef.current = toggleHighlightPen;
  /**
   * The pen's session, across windows, and the pointer spot `H` sizes it from.
   * The menu belongs to the pen, so it goes when the pen does.
   */
  useHighlightPenSession({
    armed: highlightMode,
    onPutDown: () => setHighlightMode(false),
    onBrush: setHighlightBrush,
    closeMenu: () => setHighlightMenu(null),
    sessionId: PDF_PEN_SESSION,
  });

  /**
   * The notes column, in whichever home it has: this window's row, or a window of
   * its own. Every control that reveals them goes through the same three answers.
   */
  const notes = useNotesWindow({ isWindowOfItsOwn: isViewerWindow });
  const { show: showNotes, toggle: toggleNotesPanel, revealWindow: revealNotesWindow, detach: detachNotes } = notes;
  const notesOnScreen = notes.onScreen;
  const watchNotesWindowClose = notes.watchClose;

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


  zoomRef.current = zoom;
  pageLayoutRef.current = pageLayout;
  stripHeightRef.current = stripHeight;
  stripBlurRef.current = stripBlur;
  recentsRef.current = recents;
  currentPageRef.current = currentPage;
  focusModeRef.current = focusMode;
  remarkedStripsRef.current = remarked;

  /**
   * The preferences as this window holds them, and how to read them outside a
   * render — the way out needs the newest values, not the ones it was rendered
   * with.
   */
  const latestPrefs = useCallback(() => {
    const open = openDocRef.current;
    if (!open) return null;
    return {
      stripBase: stripHeightRef.current,
      stripBlur: stripBlurRef.current,
      pageLayout: pageLayoutRef.current,
      recents: rememberPage(recentsRef.current, open.name, open.path, currentPageRef.current),
    };
  }, []);

  useViewerPrefs({
    prefs: { stripBase: stripHeight, stripBlur, pageLayout, recents },
    latest: latestPrefs,
    isWindowOfItsOwn: isReferenceViewer,
  });


  // The band's menu is anchored to a passage: a scroll, a press elsewhere or Escape
  // takes that anchor away, so the menu goes with it.
  useMenuDismiss({
    open: stripMenu !== null,
    menuRef: stripMenuRef,
    scrollerRef,
    onClose: () => setStripMenu(null),
  });

  // Ending focus mode takes the band's menu with the band.
  useEffect(() => {
    if (!focusMode) setStripMenu(null);
  }, [focusMode]);

  // A receipt, not a dialog: the save confirmation clears itself.
  useSaveToast({ message: savedToast, clear: () => setSavedToast(null) });

  // The window is named after the open document, wherever names are shown.
  useDocumentTitle({
    sourceName: pdf?.sourceName ?? null,
    appTitle: APP_TITLE,
    isWindowOfItsOwn: isReferenceViewer,
  });


  useEffect(() => {
    const open = openDocRef.current;
    if (!pdf || !open) return;
    setRecents((current) => rememberPage(current, open.name, open.path, currentPage));
  }, [currentPage, pdf]);


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

  /* There is no bare-letter toggle for the reading strip.
   *
   * `F` used to be one, and it was the odd press out: every other bare letter is
   * about a tool or a column, while the strip is entered by picking the passage it
   * frames — a double-click on a paragraph, a `⌘`-drag, or a note card that carries
   * the page and the place — and left with `Esc`. A key that can open a band over
   * whatever the reader happens to be looking at, from anywhere in the window and
   * with no passage in mind, was one accidental press away from the wrong strip.
   */

  /**
   * The scroller's place: which page is being read, and the marks the history
   * walks. Both are read from what is on screen, so they live together.
   */
  const scrollerPlace = useScrollerPlace({
    pdf,
    scrollerRef,
    layout: pageLayout,
    jumpingToPage,
    onPageShown: setCurrentPage,
    relayout: { zoom, railOpen: showThumbs, railWidth },
  });


  /** Put the page column's own offset on it. */
  const applyPan = useCallback((next: PanPoint) => {
    const pages = scrollerRef.current?.querySelector<HTMLElement>("[data-pages]");
    if (!pages) return;
    pages.style.setProperty("--pan-x", `${next.x}px`);
    pages.style.setProperty("--pan-y", `${next.y}px`);
  }, []);

  /**
   * Drop that offset: the reader has taken a place some other way, so the scroll
   * offsets are the truth again and the pages must sit exactly where they say.
   */
  const resetPan = useCallback(() => {
    panRef.current = NO_PAN;
    applyPan(NO_PAN);
  }, [applyPan]);

  // Another document starts from its own pages and its own offsets: an offset left
  // by the last one would draw the new pages off them.
  useEffect(() => {
    resetPan();
  }, [pdf, resetPan]);

  /**
   * The corrections that hold the reader's place: the point a zoom keeps still,
   * and the page corner a layout change keeps still.
   */
  useScrollAnchor({
    scrollerRef,
    zoomAnchorRef,
    layoutAnchorRef,
    layoutZoomRef,
    scrollerPlace,
    settleScrollTop: (top) => dispatch(settleActivePdfScroll(top)),
    pan: panRef,
    applyPan,
    trigger: { zoom, layout: pageLayout },
  });

  const scrollScrollerTo = useCallback((node: HTMLElement, block: "start" | "center") => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // The jump decides where the pages sit, so the zoom's own offset goes first and
    // the offset arithmetic below measures the pages where the scroll puts them.
    resetPan();
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
  }, [resetPan]);

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

  /**
   * Find in document: the query, its hits, and stepping between them. The hook
   * owns the box, because the hits and the hit the reader is on are what the
   * viewer draws; `App` only says which page to show.
   */
  const search = usePdfSearch({
    pdf,
    scrollerRef,
    inputRef: searchInputRef,
    layoutRef: pageLayoutRef,
    jumpingToPage,
    showSpreadStart: setCurrentPage,
    showPage: goToPage,
    scrollTo: scrollScrollerTo,
    zoom,
  });


  const fitWidth = useCallback(() => {
    const scroller = scrollerRef.current;
    const pages = pdfRef.current?.pages;
    const first = pages?.[0];
    if (!scroller || !first) return;
    // Fit is the reader asking for the page to fill the area: any offset a zoom
    // left behind would draw it off-centre against everything measured from here.
    resetPan();
    const rect = scroller.getBoundingClientRect();
    const widths = pages.slice(0, 2).map((page) => page.width);
    applyZoom(
      fitZoom(scroller.clientWidth, widths, pageLayoutRef.current),
      rect.left + rect.width / 2,
      rect.top + 24,
    );
  }, [applyZoom, resetPan]);

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
    // The corner this measures is the page's place, so it is measured with the
    // pages sitting exactly where their scroll offsets say.
    resetPan();
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
  }, [resetPan]);


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

  /**
   * Scroll so a point on a page sits just under the top of the window.
   *
   * `point` is CSS px on the page at zoom 1 — the space a PDF destination
   * resolves to. `null` is the top of the page. Horizontal pan moves only
   * when that x is off screen, so a centred page is not yanked sideways by a
   * link whose x is already in view.
   */
  const scrollToPdfDestination = useCallback((pageNumber: number, point: { left: number; top: number } | null) => {
    const scroller = scrollerRef.current;
    const node = scroller?.querySelector<HTMLElement>(`[data-page="${pageNumber}"]`);
    if (!scroller || !node) return;
    const shown = spreadStart(pageNumber, pageLayoutRef.current);
    jumpingToPage.current = shown;
    setCurrentPage(shown);
    if (!point) {
      scrollScrollerTo(node, "start");
    } else {
      const scrollerRect = scroller.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const scale = zoomRef.current || 1;
      const top = nodeRect.top - scrollerRect.top + scroller.scrollTop + point.top * scale - 12;
      let left = scroller.scrollLeft;
      const pointX = nodeRect.left + point.left * scale;
      if (pointX < scrollerRect.left + 12) left += pointX - scrollerRect.left - 12;
      else if (pointX > scrollerRect.right - 12) left += pointX - scrollerRect.right + 12;
      const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      scroller.scrollTo({
        top: Math.min(maxTop, Math.max(0, top)),
        left: Math.min(maxLeft, Math.max(0, left)),
      });
    }
    window.setTimeout(() => {
      if (jumpingToPage.current === shown) jumpingToPage.current = null;
    }, 400);
  }, [scrollScrollerTo]);

  const followPdfDestination = useCallback((dest: unknown) => {
    const loaded = pdfRef.current;
    if (!loaded) return;
    const seq = ++pdfLinkSeq.current;
    void resolvePdfLinkDestination(loaded.document, dest, (pageNumber) => {
      return loaded.pages[pageNumber - 1]?.pdfPage ?? null;
    }).then((target) => {
      if (!target || seq !== pdfLinkSeq.current || pdfRef.current !== loaded) return;
      scrollToPdfDestination(target.pageNumber, target.point);
    }).catch((cause: unknown) => {
      console.error(cause);
    });
  }, [scrollToPdfDestination]);

  const runPdfNamedAction = useCallback((action: string) => {
    const loaded = pdfRef.current;
    if (!loaded) return;
    const count = loaded.pages.length;
    const current = currentPageRef.current;
    if (action === "NextPage") scrollToPdfDestination(Math.min(count, current + 1), null);
    else if (action === "PrevPage") scrollToPdfDestination(Math.max(1, current - 1), null);
    else if (action === "FirstPage") scrollToPdfDestination(1, null);
    else if (action === "LastPage") scrollToPdfDestination(count, null);
    else if (action === "GoBack") stepPdfScrollHistory(-1);
    else if (action === "GoForward") stepPdfScrollHistory(1);
  }, [scrollToPdfDestination, stepPdfScrollHistory]);

  const openPdfExternalUrl = useCallback((url: string) => {
    void openExternalLink(url).catch((cause: unknown) => {
      console.error(cause);
    });
  }, []);

  pdfLinkActionsRef.current = {
    goToDestination: followPdfDestination,
    executeNamedAction: runPdfNamedAction,
    openExternal: openPdfExternalUrl,
  };

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
      search: search.closeSearch,
      notesPanel: () => setNotesPanelOpen(false),
      band: () => setFocusMode(false),
    };
    const closing = closedByEscape({
      eventLog: eventLogOpen,
      stripMenu: stripMenu !== null,
      search: search.open,
      notesPanel: notesPanelOpen,
      band: focusMode,
    });
    if (!closing) return false;
    closers[closing]();
    return true;
  }, [eventLogOpen, focusMode, notesPanelOpen, search.closeSearch, search.open, stripMenu]);

  openSearchRef.current = search.openSearch;
  stepHitRef.current = search.stepHit;
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

  /**
   * The app menu, with this window's commands. The seven intents are read through
   * a ref: the menu outlives any one render and must run the newest of each.
   */
  const menuCommands = useRef<AppMenuCommands>({
    open: () => openWithPickerRef.current(),
    newWindow: () => openAppWindowRef.current(),
    undo: () => undoHistoryRef.current(),
    redo: () => redoHistoryRef.current(),
    find: () => openSearchRef.current(),
    findNext: () => stepHitRef.current(1),
    findPrevious: () => stepHitRef.current(-1),
  });
  useAppMenu({ isWindowOfItsOwn: isReferenceViewer, commands: menuCommands });


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

  /**
   * The page area's measured size, and what a column toggle or a pinch does to the
   * zoom. Both are answers to the same question — how big is the page area now —
   * so they are measured in one place.
   */
  const stage = useStageZoom({
    stageRef,
    scrollerRef,
    pdfOpen: pdf !== null,
    zoomRef,
    layoutZoomRef,
    layoutZoomAnchor,
    applyZoom,
    cursorRef,
    layoutColumns: { eventLogOpen, notesPanelOpen, notesDetached, view },
  });

  /**
   * The band and the note badges: where they are, and what moves them. The pass
   * is the same one the reader's scroll, a zoom and a column toggle all ask for.
   */
  const layout = useBandLayout({
    stageRef,
    scrollerRef,
    overlayRef: focusOverlayRef,
    badgeNodes: remarkNodes,
    strips: remarkedStripsRef,
    bandCenterY,
    focusModeRef,
    layoutRef: pageLayoutRef,
    stripHeightRef,
    zoomRef,
    dragLockRef,
    contentLockRef,
    trigger: {
      focusMode,
      pdfOpen: pdf !== null,
      stripCount: remarked.length,
      stage: stage.size,
      layout: pageLayout,
      stripHeight,
      zoom,
    },
  });

  /**
   * The keyboard: every key the viewer answers, in one order. The map itself is
   * `useViewerShortcuts`; this only says what it may act on.
   */
  useViewerShortcuts({
    view,
    switchView,
    pdf,
    focusMode,
    annotationMode,
    annotationDraft,
    annotationMove,
    annotationMenu,
    highlightMenu,
    setAnnotationMove,
    setAnnotationDraft,
    setAnnotationError,
    setAnnotationMenu,
    setAnnotationMode,
    setHighlightMenu,
    setEventLogOpen,
    toggleRail: () => dispatch(railToggled()),
    setStripHeight,
    closeOverlays,
    eventLogOpen,
    search,
    searchInputRef,
    stepPdfScrollHistory,
    bumpZoom,
    fitWidth,
    toggleNotesPanel,
    revealNotesWindow,
    openWithPicker,
    stripHeightRef,
    zoomRef,
    toggleHighlightPenRef,
    toggleAnnotationToolRef,
    nudgeFocusStripRef,
    openAppWindowRef,
  });




  useEffect(() => {
    return () => {
      void pdfRef.current?.document.cleanup();
    };
  }, []);


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
  /**
   * Put a page point on the reading line.
   *
   * The one piece of maths behind both "stand on this saved strip" and "show me
   * that annotation": scroll the page until `fracY` of it sits `pointOffsetPx`
   * below `STRIP_LINE_FRACTION` of the stage, and report where it ended up — short
   * of the line at either end of the document, where the scroll clamps.
   */
  const alignPagePoint = useCallback(
    (node: HTMLElement, fracY: number, pointOffsetPx: number): number | null => {
      const scroller = scrollerRef.current;
      const stage = stageRef.current;
      if (!scroller || !stage) return null;
      const stageRect = stage.getBoundingClientRect();
      const pageRect = node.getBoundingClientRect();
      const placement = placeStripPoint({
        stageHeight: stageRect.height,
        lineFraction: STRIP_LINE_FRACTION,
        pageTop: pageRect.top - stageRect.top,
        pageHeight: pageRect.height,
        fracY,
        pointOffsetPx,
        scrollTop: scroller.scrollTop,
        maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
      });
      scroller.scrollTop = placement.scrollTop;
      return placement.centerY;
    },
    [],
  );

  /**
   * The band's own version of that: the strip is placed by its **centre** (that is
   * what the band is drawn around, and what it rides the page by), so half a band
   * below the line is where the band's *start* sits on it. Centring the band on the
   * line instead pushed the start of a tall strip out of the top of the viewport.
   */
  const alignStripUnderBand = useCallback(
    (node: HTMLElement, fracY: number) => {
      const bandPx = stripScreenPx(stripHeightRef.current, zoomRef.current);
      const centerY = alignPagePoint(node, fracY, bandPx / 2);
      if (centerY === null) return;
      parkedCenterYRef.current = centerY;
      layout.layoutOverlays();
    },
    [alignPagePoint, layout],
  );

  /**
   * Where a document opens, and where the app starts: the page a click asked for
   * (and the strip it asked to stand on), and the last document on launch.
   *
   * Declared down here, after the band's layout, because a strip restore has to
   * move the scroll and the band together.
   */
  usePlaceRestore({
    pdf,
    scrollerRef,
    jumpingToPage,
    pendingPage: pendingPageRestore,
    pendingStrip: pendingStripRestore,
    skipUntilZoom: skipRestoreUntilZoom,
    restoreTick,
    zoom,
    scrollToPage: (node) => scrollScrollerTo(node, "start"),
    alignStripUnderBand,
    recents,
    openRecent: openViaLibrary,
  });

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
      layout.layoutOverlays();
    },
    [commitStripCenter, layout],
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
      layout.layoutOverlays();
      requestAnimationFrame(layout.layoutOverlays);
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
      layout.layoutOverlays();
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
      layout.layoutOverlays();
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
      /* A pin's inline editor is a text field standing on the page: a double-click in
         it picks a word, and there is no band to park. */
      if (target.closest(".page-annotation-editor")) return false;
      /* Before the page's own meaning of a double-click: a press that landed on a pin
         is about that pin, so it opens the writing for editing and leaves the band
         where it was (`editAnnotationAtPress`). This is the only place the two
         gestures are told apart — the page's double-click and its selection guard both
         arrive here. */
      if (editAnnotationAtPress(clientX, clientY, target)) return true;
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
      layout.layoutOverlays();
      requestAnimationFrame(layout.layoutOverlays);
      return true;
    },
    [commitStripCenter, editAnnotationAtPress, layout, setStripHeight],
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
   *
   * The parameter is the strip's *band*, not the whole row (`StripBand`): the band
   * needs a page, a place on it and an id, and that is exactly what a window that
   * was asked to stand on a note over the bridge receives.
   */
  const parkSavedStrip = useCallback(
    (strip: StripBand, options: { keepScroll?: boolean } = {}) => {
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
        layout.layoutOverlays();
        requestAnimationFrame(layout.layoutOverlays);
        return;
      }

      // The band has no screen position until the page is measured, which is what
      // the restore below does; until then it would draw in the old place.
      parkedCenterYRef.current = null;
      pendingStripRestore.current = { fracY };
      pendingPageRestore.current = strip.page_number;
      session.bumpRestore();
    },
    [layout],
  );

  /**
   * A window opened on a passage: its document, and then the passage itself.
   *
   * The request is in this window's own query string, so it never changes; a
   * window that is not one of these has no request and nothing here runs.
   */
  useReferenceViewer({
    request: viewerRequest,
    openDocument: openViaLibrary,
    note: referenceStrip,
    annotation: referenceAnnotation,
    pdf,
    scrollerRef,
    parkStrip: parkSavedStrip,
    revealStrip: setRevealStripId,
    alignPagePoint,
    showPage: setCurrentPage,
    foundAnnotation: setFoundAnnotationId,
  });

  /* ── A reference that lands in *this* window ──────────────────────────────
     A reference opens a viewer window of its own — unless a subwindow already
     has the note's document open, which is the window the click is answered in
     instead of stacking a second one on the same PDF (`openViewers.ts` decides
     which). These are the two answers that can land here: a message from the
     window that was clicked, and the click of a reference *inside* this window
     when this window is the one that already has the document (itself included).

     Both are what a reference viewer does when it opens on a passage — the band
     over the note's strip with the column's card marked and scrolled to, or the
     pin ringed on the reading line — so a warm window answers exactly like a new
     one, and the reader cannot tell which they got. */

  /* Publish what this window shows, so a click in any other window can find it.
     Written on every document change and withdrawn when the document is closed;
     the main window publishes too, and the readers leave it out (see
     `windowBridge.referencePlacementFor`). */
  useEffect(() => {
    publishViewerDocument(openPath);
  }, [openPath]);

  /**
   * Stand this window on a saved strip, the way a card's click does.
   *
   * The band goes over the strip — focus mode on, the page scrolled so the strip
   * sits on the reading line — and the strip is named for the notes column, which
   * opens the folder holding it, marks the card (the wobble is the mark) and puts
   * it on the column's line. `setRevealStripId` is that request: the same one a
   * badge makes, answered by `StripList` in this window or in the window the
   * column was popped out into.
   */
  const showStripHere = useCallback(
    (strip: StripBand) => {
      setRevealStripId(strip.id);
      parkSavedStrip(strip);
    },
    [parkSavedStrip, setRevealStripId],
  );

  /**
   * A pin a reference asked for, waiting until the page it stands on is on screen.
   *
   * State rather than a one-shot: a window that has just opened a document has no
   * pages yet when the request arrives, and the request must survive until they
   * exist. `filePath` travels with it so a document change in between drops it
   * instead of placing the pin on the same page number of another PDF.
   */
  const [pendingAnnotationSpot, setPendingAnnotationSpot] = useState<ShowAnnotationRequest | null>(null);

  /**
   * Show a pin here: the page scrolled so the pin's point sits on the reading
   * line — a fifth of the way down the page area — and the pin ringed once it can
   * be.
   *
   * The PDF view is brought on screen first: a request can arrive while the
   * Dashboard tab is up, and scrolling a page nobody is looking at would look like
   * the click did nothing. The scroll waits for the pages either way, so the order
   * of these two calls only decides which render lays the page out.
   */
  const showAnnotationHere = useCallback(
    (request: ShowAnnotationRequest) => {
      switchView("pdf");
      setPendingAnnotationSpot(request);
    },
    [switchView],
  );

  useEffect(() => {
    if (!pendingAnnotationSpot) return;
    if (pendingAnnotationSpot.filePath !== openPath) {
      setPendingAnnotationSpot(null);
      return;
    }
    const { annotation } = pendingAnnotationSpot;
    const page = annotation.page_number;
    const height = pdf?.pages.find((candidate) => candidate.index === page)?.height ?? 0;
    if (height <= 0) return;
    const node = scrollerRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (!node) return;
    setPendingAnnotationSpot(null);
    alignPagePoint(node, annotationPointFrac(annotation, height), 0);
    setCurrentPage(page);
    setFoundAnnotationId(annotation.id);
  }, [alignPagePoint, openPath, pdf, pendingAnnotationSpot, setCurrentPage]);

  /* The other window's click: "you have this document, stand on this strip." */
  useEffect(() => {
    if (!isTauri()) return;
    return subscribe<unknown>(ViewerEvent.ShowNote, (payload) => {
      const request = parseShowNoteRequest(payload);
      if (!request || request.filePath !== openPathRef.current) return;
      showStripHere(request.strip);
    });
  }, [showStripHere]);

  /* The same, for a pin. */
  useEffect(() => {
    if (!isTauri()) return;
    return subscribe<unknown>(ViewerEvent.ShowAnnotation, (payload) => {
      const request = parseShowAnnotationRequest(payload);
      if (!request || request.filePath !== openPathRef.current) return;
      showAnnotationHere(request);
    });
  }, [showAnnotationHere]);

  /**
   * Show a referenced annotation: scroll the PDF viewer onto the pin.
   *
   * One function for every view — the docked column, the popped-out column and the
   * Dashboard tab answer a click the same way: the page comes up with the pin's
   * point a fifth of the way down it, the pin ringed once, and nothing else moves.
   * That is what a reference asks for: where the thing is, not a reading window of
   * its own.
   *
   * The window that answers is one already showing that PDF, and a click made in
   * such a window is answered in it — the original window included, since the reader
   * is looking at that page and the scroll is the smallest answer (`selfMayAnswer`).
   * A subwindow that has the document is told to stand on the pin: it comes forward
   * and scrolls exactly as this window would have. Only when no window has the
   * document is a viewer opened, and then one per click: a chain of references into
   * a PDF nobody has open would otherwise be a window per link. The plain web build
   * has no second window, so there the answer is the open document's own viewer —
   * and only when it is that document.
   */
  const showReferencedAnnotation = useCallback(
    async (annotation: AnnotationWithDocument) => {
      const document = annotation.pdf_document;
      if (!document) return;

      const request: ShowAnnotationRequest = {
        filePath: document.file_path,
        annotation: { id: annotation.id, page_number: annotation.page_number, y: annotation.y },
      };

      if (isTauri()) {
        const placement = await referencePlacementFor(document.file_path, openPath, {
          selfMayAnswer: true,
        });
        if (placement.kind === "here") {
          showAnnotationHere(request);
          return;
        }
        if (placement.kind === "window" && (await showAnnotationInViewerWindow(placement.label, request))) {
          return;
        }
        try {
          await openReferenceViewerWindow({ filePath: document.file_path, annotationId: annotation.id });
          return;
        } catch (cause) {
          console.error(cause);
          setSavedToast("Could not open the annotation's window.");
          return;
        }
      }

      if (openPath !== document.file_path) {
        setSavedToast(`That annotation is in “${document.name}”.`);
        return;
      }
      showAnnotationHere(request);
    },
    [openPath, showAnnotationHere],
  );

  /**
   * The annotation a reference-viewer window was opened for, once the document is
   * up: put its point on the reading line and ring it.
   *
   * Nothing is parked and focus mode stays off — the reader asked to see a place,
   * not to read one band of the page. The page's own height is what turns the
   * stored point into the fraction the scroll maths wants; without it the point
   * cannot be placed and the effect waits for the next render.
   */

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
  /**
   * The other window's side of the conversation: the snapshot it is sent, the
   * requests it makes, and the confirmations it sends back.
   */
  useNotesWindowBridge({
    detached: notesDetached,
    context: notesContext,
    parkStrip: parkSavedStrip,
    clearReveal,
    clearPendingEdit: () => setPendingNoteEditId(null),
    revealNote: (strip) => void showReferencedNote(strip),
    revealAnnotation: (annotation) => void showReferencedAnnotation(annotation),
    adopt: watchNotesWindowClose,
    onDetachedChange: setNotesDetached,
  });

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
   * One function for every view, because the answer is the same everywhere, and
   * the answer is a *window* on that note's document: a reference is
   * cross-document by design — it was copied out of one document's note and
   * pasted into another's, or into an annotation's — so a window is the one
   * answer that works from the docked column, the popped-out column and the
   * Dashboard tab alike, and it leaves the window the reader was in exactly as it
   * was.
   *
   * Which window depends on what is already up:
   *
   * - **This window, when it is a subwindow already showing that PDF.** Nothing is
   *   asked of anyone: the reader is in the window that has the note's document,
   *   so the note is selected here.
   * - **Another subwindow showing that PDF.** It is told to stand on the note —
   *   the band parked, the card marked and scrolled to — and brought forward, the
   *   same answer a viewer window opened on the note gives. One window per document
   *   is what makes following a chain of references usable; a window per click is a
   *   window per link.
   * - **Nothing has it open.** A window of its own, on that document, with the
   *   band parked on the note (its own `useReferenceViewer` pass places it).
   *
   * Only the last case makes a window, and the main window is never the window a
   * reference is answered in — which is also what lets the same PDF be open in it
   * and in a subwindow at once.
   *
   * Each such window is an independent instance of this app — its own pages, zoom
   * and store — so nothing it does can disturb the document on this side. The
   * plain web build has no second window at all, and keeps the docked column's
   * answer below.
   */
  const showReferencedNote = useCallback(
    async (strip: NoteWithDocument) => {
      const document = strip.pdf_document;
      if (!document) return;

      if (isTauri()) {
        const request: ShowNoteRequest = {
          filePath: document.file_path,
          strip: {
            id: strip.id,
            page_number: strip.page_number,
            top: strip.top,
            height: strip.height,
            page_height: strip.page_height,
          },
        };
        const placement = await referencePlacementFor(document.file_path, openPath);
        if (placement.kind === "here") {
          showStripHere(request.strip);
          return;
        }
        if (placement.kind === "window" && (await showNoteInViewerWindow(placement.label, request))) {
          return;
        }
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
    [openPath, showNotes, showStripHere, setRevealStripId],
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
   * The same handle for an annotation reference.
   *
   * Memoised for the same reason as the note's: it reaches every note card through
   * `MarkdownNote`, and a new function per render would re-parse every card in the
   * column on each toast or page tick.
   */
  const revealReferencedAnnotation = useCallback(
    (annotation: AnnotationWithDocument) => void showReferencedAnnotation(annotation),
    [showReferencedAnnotation],
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
  /**
   * Hand a badge's element to the layout pass, which is the only code that can
   * place it: a badge cannot ride the page's scroll in CSS.
   */
  const registerRemarkNode = useCallback((id: number, node: HTMLButtonElement | null) => {
    if (node) remarkNodes.current.set(id, node);
    else remarkNodes.current.delete(id);
  }, []);

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

  /**
   * Where a press fell on a page, in the page's own points.
   *
   * Read at the press, for whichever menu opens: the pointer is on the menu by the
   * time an item is clicked, so both the band's "Add annotation" and the page's
   * "Add annotation here" pin the words the right-click was about. `null` when the
   * press was not on a page — in the dark beside the sheet, or between two sheets
   * under the band — because there is nothing there to pin to.
   */
  const pageSpotAt = (
    target: EventTarget | null,
    clientX: number,
    clientY: number,
  ): { page: number; point: PagePoint } | null => {
    const shell = target instanceof Element ? target.closest(".page-shell") : null;
    if (!(shell instanceof HTMLElement)) return null;
    const page = Number.parseInt(shell.dataset.page ?? "", 10);
    const shellRect = shell.getBoundingClientRect();
    const pageWidth = pdfRef.current?.pages.find((candidate) => candidate.index === page)?.width ?? 0;
    const pageHeight = pdfRef.current?.pages.find((candidate) => candidate.index === page)?.height ?? 0;
    if (!Number.isInteger(page) || shellRect.width <= 0) return null;
    const cssPerPoint = shellRect.width / (pageWidth > 0 ? pageWidth : 1);
    return {
      page,
      point: clampAnnotationPoint(
        (clientX - shellRect.left) / cssPerPoint,
        (clientY - shellRect.top) / cssPerPoint,
        pageWidth,
        pageHeight,
      ),
    };
  };

  /** Right-click on the display strip opens the menu at the cursor. */
  const onStripContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    textBrushPt: number | null,
    spot: { page: number; point: PagePoint } | null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setStripSaveState("idle");
    setStripSaveMessage(null);
    setStripMenu({ x: event.clientX, y: event.clientY, brushPt: textBrushPt, spot });
  };

  /**
   * Right-click anywhere on the page.
   *
   * The native menu stays closed: the viewer has its own. The hole no longer
   * takes the press — that is what lets the text under it be selected — so a
   * right-click in the strip lands on the page and is recognised by where it
   * fell, not by which element received it.
   *
   * Two menus, one for each side of that line, and both about the passage under
   * the press. Inside the band, the band's menu — save the note, the pen toggle,
   * and "Add annotation". Outside it, the page's menu, with the same pen toggle
   * and the same pin: before them, the Highlight and Annotation buttons were the
   * only ways to arm either, and they sit in a toolbar away from the passage about
   * to be marked. Both write to the page, so both ask `pageSpotAt` where the press
   * fell.
   */
  const onStageContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    // A right-click while a pin is in the hand is not a menu: the drag owns the
    // pointer, and letting go is what places the piece. The native menu is still
    // kept shut.
    event.preventDefault();
    if (annotationMoveRef.current) return;
    const target = event.target;
    const ownedByControl =
      target instanceof Element &&
      target.closest(".remark-marker, .search-bar, .strip-menu") !== null;
    if (ownedByControl) return;
    // The line the press landed on is the passage about to be marked, and its
    // font height is the brush it wants. Read here, where the press was: by the
    // time the menu item is clicked the pointer is on the menu.
    const textBrushPt = brushUnderPoint(event.clientX, event.clientY);
    // The same measurement serves both menus: the band takes it so its own
    // "Add annotation" can pin the passage, and the page keeps it as before.
    const spot = pageSpotAt(target, event.clientX, event.clientY);
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
      onStripContextMenu(event, textBrushPt, spot);
      return;
    }

    // Outside the band (or with no band): the page's own menu. It belongs to a
    // page the press actually landed on — a right-click in the dark beside the
    // page is not about a passage.
    if (!spot) return;
    setPageMenu({
      x: event.clientX,
      y: event.clientY,
      brushPt: textBrushPt,
      page: spot.page,
      point: spot.point,
    });
  };

  /**
   * Pin a piece of text where a menu opened.
   *
   * One press, one pin: the menu closes first, and the editor opens at the point
   * the right-click fell rather than where the menu was. A PDF that is not in the
   * library has no row a pin could belong to, so the press is refused with a
   * message instead of an editor that could only open onto a refusal.
   */
  const addAnnotationAt = useCallback(
    (spot: { page: number; point: PagePoint }, clientX: number, clientY: number) => {
      if (openDocumentId == null) {
        setSavedToast("This PDF is not in the library yet, so it cannot hold annotations.");
        return;
      }
      setAnnotationMode(true);
      beginAnnotation(spot.page, spot.point, clientX, clientY);
    },
    [beginAnnotation, openDocumentId, setAnnotationMode],
  );

  /**
   * The band's "Add annotation" item, bound to the place the press fell.
   *
   * Two consts rather than one closure over the menu's state, so the place is read
   * once, at the press, and the click spends it: the pointer is on the menu by the
   * time the item is chosen. `undefined` when the band stood over the gap between
   * two pages — there is no page there to pin to, so the item is left out instead
   * of being offered and then refused.
   */
  const stripMenuSpot = stripMenu?.spot ?? null;
  const stripMenuAddAnnotation =
    stripMenu && stripMenuSpot
      ? () => {
        const { x, y } = stripMenu;
        setStripMenu(null);
        addAnnotationAt(stripMenuSpot, x, y);
      }
      : undefined;

  const onStageDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    parkFocusAtPoint(event.clientX, event.clientY, event.target);
  };

  useSelectionGuard({ stageRef, onDoublePress: parkFocusAtPoint });


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

  /**
   * A PDF dropped on the window. The veil covers the whole app, because a drop
   * lands wherever it is released; the desktop's paths go through the library,
   * the browser's bytes through the viewer.
   */
  const drop = usePdfDropTarget({
    onVeil: (active) => dispatch(dropVeilChanged(active)),
    openPaths: (paths) => openViaLibrary(paths),
    openFiles,
    onRejected: () => setSavedToast("Drop a PDF to open it."),
  });


  /**
   * The notes column's width: remembered in the backend, clamped against the row
   * it shares with the page, and dragged by its own seam.
   *
   * A width is remembered, the window is not — the hook re-applies the ceiling
   * whenever the viewer changes size, and a width that already fits is left alone.
   */
  const notesColumn = useDockedColumnWidth({
    defaultValue: DEFAULT_NOTES_PANEL,
    minWidth: MIN_NOTES_PANEL,
    maxWidthFor: maxNotesPanelWidth,
    resolveDrag: resolveNotesPanelDrag,
    restoredWidth: restoredNotesPanelWidth,
    stageRef,
    paneRef: notesPaneRef,
    stageSize: stage.size,
    storedLoaded: appState !== undefined,
    storedWidth: appState?.notes_panel_width,
    persist: (width) => void updateAppState({ notes_panel_width: Math.round(width) }),
    close: () => setNotesPanelOpen(false),
  });


  /**
   * The event log's width: the same docked-column rules as the notes column's,
   * with the log's own numbers and its own close.
   */
  const eventLogColumn = useDockedColumnWidth({
    defaultValue: DEFAULT_EVENT_LOG_PANEL,
    minWidth: MIN_EVENT_LOG_PANEL,
    maxWidthFor: maxEventLogPanelWidth,
    resolveDrag: resolveEventLogPanelDrag,
    restoredWidth: restoredEventLogPanelWidth,
    stageRef,
    paneRef: eventLogPaneRef,
    stageSize: stage.size,
    storedLoaded: appState !== undefined,
    storedWidth: appState?.event_log_panel_width,
    persist: (width) => void updateAppState({ event_log_panel_width: Math.round(width) }),
    close: () => setEventLogOpen(false),
  });



  /**
   * The moves the chrome can ask for. They are the viewer's own handlers, offered
   * once to whoever needs them, so no control has to be handed twelve callbacks to
   * do one thing.
   */
  const commands: ViewerCommands = useMemo(
    () => ({
      openPicker: () => void openWithPicker(),
      openRecent: (path, name) => void openViaLibrary(path, name),
      goToPage,
      stepScrollHistory: stepPdfScrollHistory,
      chooseLayout: choosePageLayout,
      zoomBy: bumpZoom,
      fitWidth,
      toggleHighlightPen: (brushPt) => toggleHighlightPen(brushPt),
      toggleNotesPanel,
      openSearch: search.openSearch,
      parkStrip: parkSavedStrip,
      revealNote: (note) => void showReferencedNote(note),
      revealAnnotation: (annotation) => void showReferencedAnnotation(annotation),
      detachNotes: () => void detachNotes(),
    }),
    [
      bumpZoom,
      choosePageLayout,
      detachNotes,
      fitWidth,
      goToPage,
      openWithPicker,
      openViaLibrary,
      parkSavedStrip,
      search.openSearch,
      showReferencedAnnotation,
      showReferencedNote,
      stepPdfScrollHistory,
      toggleHighlightPen,
      toggleNotesPanel,
    ],
  );

  return (
    <ViewerCommandsProvider value={commands}>
      <div
        className="app"
        onDragEnter={drop.onDragEnter}
        onDragOver={drop.onDragOver}
        onDragLeave={drop.onDragLeave}
        onDrop={(event) => void drop.onDrop(event)}
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
            {/* The window's second chrome row: every control that acts on the
          open document. The row and its clusters live in `components/toolbar`,
          down to the drag surface that makes it chrome. */}
            <PdfToolbar />

            <div className="workspace">
              {pdf && (
                <PDFThumbnailRail pages={pdf.pages} sourceName={pdf.sourceName} />
              )}
              <ViewerStage
                stageRef={stageRef}
                onPointerDown={onStagePointerDown}
                onPointerMove={onPointerMove}
                onPointerLeave={onStagePointerLeave}
                onDoubleClick={onStageDoubleClick}
                onContextMenu={onStageContextMenu}
                search={
                  search.open
                    ? {
                      committedQuery: search.query,
                      onCommit: search.commitQuery,
                      onStep: search.stepHit,
                      onClose: search.closeSearch,
                      inputRef: searchInputRef,
                      activeHit: search.activeHit,
                      hitCount: search.hits.length,
                    }
                    : null
                }
                pages={{
                  pdf,
                  scrollerRef,
                  highlights: {
                    marks: documentMarks,
                    penDown: highlightMode,
                    onStroke: addDocumentStroke,
                    onMenu: (page, mark, x, y) => setHighlightMenu({ page, mark, x, y }),
                  },
                  annotations: {
                    ofPage: annotationsOfPage,
                    toolArmed: annotationMode,
                    onPlace: beginAnnotation,
                    onMenu: (annotation, x, y) => {
                      const row = documentAnnotations.find((candidate) => candidate.id === annotation.id);
                      if (row) setAnnotationMenu({ annotation: row, x, y });
                    },
                    foundId: foundAnnotationId,
                    movingId,
                    onPress: pressAnnotation,
                    content: {
                      documentId: openDocumentId,
                      onRevealNote: revealReferencedNote,
                      onRevealAnnotation: revealReferencedAnnotation,
                      onText: writeAnnotationText,
                      onResize: writeAnnotationWidth,
                      onMenu: (annotation, x, y) => {
                        const row = documentAnnotations.find((candidate) => candidate.id === annotation.id);
                        if (row) setAnnotationMenu({ annotation: row, x, y });
                      },
                    },
                    /**
                     * The writing being changed, in place on its page.
                     *
                     * Only an existing pin ever gets here: a new one is written in the
                     * box that placed it (see `annotations.draft` below).
                     */
                    edit:
                      annotationDraft?.mode === "edit"
                        ? {
                          editingId: annotationDraft.id,
                          saving: annotationSaving,
                          error: annotationError,
                          onSave: (text) => void saveAnnotationDraft(text),
                          onCancel: cancelAnnotationDraft,
                        }
                        : null,
                  },
                  empty: {
                    busy,
                    onOpenPicker: () => void openWithPicker(),
                    onOpenRecent: (doc) => doc.path && void openViaLibrary(doc.path, doc.name),
                  },
                  linkActionsRef: pdfLinkActionsRef,
                }}
                remarks={
                  pdf && remarked.length > 0
                    ? {
                      strips: remarked,
                      registerNode: registerRemarkNode,
                      onRemarkClick,
                      onRemarkDoubleClick,
                    }
                    : null
                }
                focus={
                  pdf && focusMode
                    ? {
                      blur: stripBlur,
                      overlayRef: focusOverlayRef,
                      onWheel: onFocusWheel,
                      onEdgeResize,
                    }
                    : null
                }
                selectBandRef={stripSelectRef}
                stripMenu={
                  stripMenu
                    ? {
                      x: stripMenu.x,
                      y: stripMenu.y,
                      menuRef: stripMenuRef,
                      updating: displayStripId !== null,
                      saveState: stripSaveState,
                      saveMessage: stripSaveMessage,
                      onSave: () => void saveDisplayStrip(),
                      onToggleHighlight: () => {
                        // The menu goes before the pen arms, so its measured brush is
                        // carried across first.
                        const brushPt = stripMenu.brushPt;
                        setStripMenu(null);
                        toggleHighlightPen(brushPt);
                      },
                      // The pin goes where the press fell — the same place the
                      // page's menu would have pinned it had the band been off.
                      onAddAnnotation: stripMenuAddAnnotation,
                    }
                    : null
                }
                pageMenu={
                  pageMenu
                    ? {
                      x: pageMenu.x,
                      y: pageMenu.y,
                      onToggleHighlight: () => {
                        const brushPt = pageMenu.brushPt;
                        setPageMenu(null);
                        toggleHighlightPen(brushPt);
                      },
                      // One press, one pin: the menu closes first, and the editor
                      // opens where the right-click fell rather than where the menu
                      // was. The refusal for a PDF outside the library is the band's
                      // too, so it lives in `addAnnotationAt` beside the write.
                      onAddAnnotation: () => {
                        const { page, point, x, y } = pageMenu;
                        setPageMenu(null);
                        addAnnotationAt({ page, point }, x, y);
                      },
                      onClose: () => setPageMenu(null),
                    }
                    : null
                }
                annotations={{
                  draft: annotationDraft,
                  saving: annotationSaving,
                  error: annotationError,
                  onSaveDraft: (text) => void saveAnnotationDraft(text),
                  onCancelDraft: cancelAnnotationDraft,
                  menu: annotationMenu
                    ? {
                      ...annotationMenu,
                      // The live row, not the one the menu opened on: the reader can
                      // take the size up and down without the menu closing.
                      fontPt: annotationFontPt(
                        documentAnnotations.find((row) => row.id === annotationMenu.annotation.id)
                          ?.font_size ?? annotationMenu.annotation.font_size,
                      ),
                    }
                    : null,
                  onEditWithPreview: openAnnotationPreview,
                  onCopyReference: (id) => void copyAnnotationReference(id),
                  onDelete: (id) => void removeAnnotation(id),
                  onFontSize: (annotation, fontPt) => writeAnnotationFontSize(annotation, fontPt),
                  onFontPreview: (annotation, fontPt) =>
                    setAnnotationFontDraft({ id: annotation.id, fontPt }),
                  onCloseMenu: () => {
                    // Leaving the menu mid-drag drops the preview: the row is what the
                    // page draws, and nothing was committed.
                    setAnnotationFontDraft(null);
                    setAnnotationMenu(null);
                  },
                }}
                highlightMenu={
                  highlightMenu
                    ? {
                      x: highlightMenu.x,
                      y: highlightMenu.y,
                      onDelete: () => {
                        removeDocumentStroke(highlightMenu.page, highlightMenu.mark);
                        setHighlightMenu(null);
                      },
                      onClose: () => setHighlightMenu(null),
                    }
                    : null
                }
              />

              {/* Popped out, neither column is drawn here: it lives in the other
            window, which shows the same message for a pathless PDF. */}
              {!notesDetached && pdf && (
                <NotesColumn
                  width={notesColumn.width}
                  onResizeStart={notesColumn.resizeStart}
                  paneRef={notesPaneRef}
                />
              )}

            </div>

          </div>

          {view === "dashboard" && (
            <DashboardTab
              eventLogOpen={eventLogOpen}
              onToggleEventLog={toggleEventLog}
              onOpenDocument={(document) => void openDocumentFromNotes(document)}
              onOpenDocumentInNewWindow={
                isTauri() ? (document) => void openDocumentInNewWindow(document) : undefined
              }
              onOpenStrip={(document, strip) => void openStripFromNotes(document, strip)}
              onRevealNote={revealReferencedNote}
              onRevealAnnotation={revealReferencedAnnotation}
              onDocumentDeleted={(document) => void onDocumentDeleted(document)}
              onStatus={setSavedToast}
              pendingEditId={pendingNoteEditId}
              onPendingEditHandled={() => setPendingNoteEditId(null)}
            />
          )}

          {/* Last column of the row, outermost on the right: whatever is on screen —
          the page, or the Dashboard's two panes — keeps the width the log leaves.
          Docked rather than laid over the view, so it never swallows a click meant
          for the surface beside it. */}
          <EventLogPanel
            paneRef={eventLogPaneRef}
            width={eventLogColumn.width}
            onResizeStart={eventLogColumn.resizeStart}
          />

        </div>

        <SaveToast />

        {/* The markdown popup a pin's writing is written in: the notes column's
            dialog without the page band, because a pin is pinned to a point rather
            than to a strip. Portalled to the body by the dialog itself, so its
            place here only says that the window owns it. */}
        {previewAnnotation && (
          <AnnotationMarkdownDialog
            annotation={previewAnnotation}
            documentName={pdf?.sourceName ?? APP_TITLE}
            documentId={openDocumentId}
            saving={annotationSaving}
            error={annotationError}
            onSave={(markdown) => void saveAnnotationPreview(markdown)}
            onCancel={cancelAnnotationPreview}
            onRevealNote={revealReferencedNote}
            onRevealAnnotation={revealReferencedAnnotation}
          />
        )}

        <PdfDropVeil />

        <PdfFileInput inputRef={fileInputRef} onFiles={(files) => void openFiles(files)} />
      </div>
    </ViewerCommandsProvider>
  );
}

