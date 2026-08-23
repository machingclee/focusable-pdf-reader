import { getCurrentWebview } from "@tauri-apps/api/webview";
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
import {
  fileNameFromPath,
  loadPdfFromBytes,
  renderPageToCanvas,
  renderPageTextLayer,
  type LoadedPage,
  type LoadedPdf,
} from "./pdf";
import { findHits, type SearchBox, type SearchHit } from "./search";
import {
  dropRecent,
  filePathFromFile,
  loadPrefs,
  rememberRecent,
  savePrefs,
  type RecentDoc,
} from "./prefs";
import { installAppMenu } from "./appMenu";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 6;
const MIN_STRIP = 40;
const MAX_STRIP = 640;
const DEFAULT_STRIP_AT_100 = 160;
const MIN_RAIL = 132;
const MAX_RAIL = 360;
const DEFAULT_RAIL = 176;
const RAIL_CHROME = 28;
const STRIP_STEP = 12;
const MAX_STRIP_BASE = MAX_STRIP / MIN_ZOOM;
const MIN_STRIP_BASE = MIN_STRIP / MAX_ZOOM;
const initialPrefs = loadPrefs();
const NO_HITS: Array<{ index: number; boxes: SearchBox[] }> = [];
const SEARCH_DEBOUNCE_MS = 250;

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  layoutZoom,
  renderZoom,
  hits,
  activeHit,
}: {
  page: LoadedPage;
  layoutZoom: number;
  renderZoom: number;
  hits: Array<{ index: number; boxes: SearchBox[] }>;
  activeHit: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(false);

  const cssWidth = page.width * layoutZoom;
  const cssHeight = page.height * layoutZoom;

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
        width: cssWidth,
        height: cssHeight,
        ["--total-scale-factor" as string]: layoutZoom,
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
                  left: box.left * layoutZoom,
                  top: box.top * layoutZoom,
                  width: box.width * layoutZoom,
                  height: box.height * layoutZoom,
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
  const focusMaskTopRef = useRef<HTMLDivElement>(null);
  const focusBandRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<LoadedPdf | null>(null);
  const zoomRef = useRef(1);
  const stripBaseRef = useRef(DEFAULT_STRIP_AT_100);
  const gestureStartZoom = useRef(1);
  const gestureActive = useRef(false);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const jumpingToPage = useRef<number | null>(null);
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null);
  const railPaneRef = useRef<HTMLElement>(null);
  const restoredLast = useRef(false);
  const openSearchRef = useRef<() => void>(() => {});
  const stepHitRef = useRef<(delta: number) => void>(() => {});
  const openWithPickerRef = useRef<() => void>(() => {});

  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [zoom, setZoom] = useState(1);
  const [focusMode, setFocusMode] = useState(false);
  const [showThumbs, setShowThumbs] = useState(true);
  const [railWidth, setRailWidth] = useState(DEFAULT_RAIL);
  const [currentPage, setCurrentPage] = useState(1);
  const [stripBase, setStripBase] = useState(() =>
    clamp(initialPrefs.stripBase, MIN_STRIP_BASE, MAX_STRIP_BASE),
  );
  const [recents, setRecents] = useState<RecentDoc[]>(() => initialPrefs.recents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stageHeight, setStageHeight] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeHit, setActiveHit] = useState(-1);
  const [pageDraft, setPageDraft] = useState("1");

  const renderZoom = useDebouncedValue(zoom, 140);
  const onScreenStrip = stripBase * zoom;
  const thumbWidth = Math.max(72, railWidth - RAIL_CHROME);

  zoomRef.current = zoom;
  stripBaseRef.current = stripBase;

  useEffect(() => {
    savePrefs({ stripBase, recents });
  }, [stripBase, recents]);

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

  const applyZoom = useCallback((nextZoom: number, clientX: number, clientY: number) => {
    const current = zoomRef.current;
    const clamped = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(clamped - current) < 0.0001) return;
    zoomAnchorRef.current = captureZoomAnchor(clientX, clientY);
    zoomRef.current = clamped;
    setZoom(clamped);
  }, [captureZoomAnchor]);

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
    setPdf(null);
    setCurrentPage(1);
    setHits([]);
    setActiveHit(-1);
    setSearchQuery("");
    setSearchOpen(false);
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
        void pdfRef.current?.document.cleanup();
        pdfRef.current = loaded;
        setPdf(loaded);
        setCurrentPage(1);
        setHits([]);
        setActiveHit(-1);
        setRecents((current) => rememberRecent(current, sourceName, options.path));

        requestAnimationFrame(() => {
          const scroller = scrollerRef.current;
          const first = loaded.pages[0];
          if (fitWidth && scroller && first) {
            const next = clamp((scroller.clientWidth - 72) / first.width, MIN_ZOOM, MAX_ZOOM);
            zoomRef.current = next;
            setZoom(next);
          }
          scroller?.scrollTo({ top: 0, left: 0 });
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

  const setOnScreenStrip = useCallback((nextOnScreen: number) => {
    const next = clamp(nextOnScreen, MIN_STRIP, MAX_STRIP);
    setStripBase(clamp(next / zoomRef.current, MIN_STRIP_BASE, MAX_STRIP_BASE));
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

    const updateStageHeight = () => setStageHeight(stage.clientHeight);
    updateStageHeight();
    const observer = new ResizeObserver(updateStageHeight);
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
        bumpZoom(1.1);
        return;
      }
      if (meta && event.key === "-") {
        event.preventDefault();
        bumpZoom(1 / 1.1);
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
        setFocusMode((value) => !value);
        return;
      }
      if (event.key.toLowerCase() === "t" && !meta && !event.altKey) {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        setShowThumbs((value) => !value);
        return;
      }
      if (event.key === "[" || event.key === "]") {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        const direction = event.key === "]" ? 1 : -1;
        const step = STRIP_STEP * (event.shiftKey ? 3 : 1) * (meta ? 2 : 1);
        setOnScreenStrip(stripBaseRef.current * zoomRef.current + direction * step);
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [bumpZoom, closeSearch, fitWidth, focusMode, openSearch, openWithPicker, searchOpen, setOnScreenStrip, stepHit]);

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

  const focusYRef = useRef<number | null>(null);

  const layoutFocusOverlay = useCallback((relativeY?: number) => {
    const stage = stageRef.current;
    const mask = focusMaskTopRef.current;
    const band = focusBandRef.current;
    if (!stage || !mask || !band) return;
    const height = stripBaseRef.current * zoomRef.current;
    const stageHeightNow = stage.clientHeight;
    const y = relativeY ?? focusYRef.current ?? stageHeightNow / 2;
    focusYRef.current = y;
    const holeTop = clamp(y - height / 2, 0, Math.max(0, stageHeightNow - height));
    mask.style.height = `${holeTop}px`;
    band.style.height = `${height}px`;
  }, []);

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    cursorRef.current = { x: event.clientX, y: event.clientY };
  };

  const onStageDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!pdfRef.current) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".search-bar") || target.closest(".empty")) return;
    if (!target.closest(".page-shell") && !target.closest(".pages")) return;

    const stage = stageRef.current;
    if (!stage) return;
    const y = event.clientY - stage.getBoundingClientRect().top;
    cursorRef.current = { x: event.clientX, y: event.clientY };
    focusYRef.current = y;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    setFocusMode(true);
    requestAnimationFrame(() => layoutFocusOverlay(y));
  };

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

  useLayoutEffect(() => {
    if (focusMode) layoutFocusOverlay();
  }, [focusMode, layoutFocusOverlay, onScreenStrip, stageHeight, zoom]);

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
      {busy && <div className="loading-bar" />}
      <header className="toolbar">
        <div className="brand">
          <strong>PDF Reader</strong>
          <span>With Focus</span>
        </div>

        <div className="toolbar-cluster">
          <button className="primary" onClick={() => void openWithPicker()}>
            Open PDF
          </button>
          <label className="recents-picker">
            <span>Recents</span>
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
          <button className="ghost" onClick={closePdf} disabled={!pdf}>
            Close
          </button>
        </div>

        <div className="toolbar-cluster grow">
          <div className="file-meta">
            {pdf ? (
              <>
                <span className="file-name">{pdf.sourceName}</span>
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
              </>
            ) : (
              "No document open"
            )}
          </div>
          {error && <span className="status-error">{error}</span>}
        </div>

        <div className="toolbar-cluster">
          <button
            className={focusMode ? "ghost active" : "ghost"}
            onClick={() => setFocusMode((value) => !value)}
            aria-pressed={focusMode}
            disabled={!pdf}
          >
            Focus
          </button>
          <label className="strip-control">
            <span>Strip</span>
            <input
              type="range"
              min={MIN_STRIP}
              max={MAX_STRIP}
              value={Math.round(clamp(onScreenStrip, MIN_STRIP, MAX_STRIP))}
              disabled={!pdf || !focusMode}
              onChange={(event) => setOnScreenStrip(Number(event.target.value))}
            />
            <span className="strip-readout">{Math.round(onScreenStrip)}px</span>
          </label>
        </div>

        <div className="toolbar-cluster">
          <button className="icon" onClick={() => bumpZoom(1 / 1.1)} disabled={!pdf} aria-label="Zoom out">
            −
          </button>
          <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
          <button className="icon" onClick={() => bumpZoom(1.1)} disabled={!pdf} aria-label="Zoom in">
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
      </header>

      <div className="workspace">
        {pdf && showThumbs && (
          <aside
            className="thumbs-pane"
            ref={railPaneRef}
            style={{ width: railWidth }}
          >
            <div className="thumbs-head">
              <button
                className="ghost active"
                onClick={() => setShowThumbs(false)}
                aria-pressed="true"
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
            <button className="ghost" onClick={() => setShowThumbs(true)}>
              Pages
            </button>
          </div>
        )}
        <div
          className="stage"
          ref={stageRef}
          onPointerMove={onPointerMove}
          onDoubleClick={onStageDoubleClick}
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
              <div className="pages">
                {pdf.pages.map((page) => (
                  <PdfPageView
                    key={`${pdf.sourceName}-${page.index}`}
                    page={page}
                    layoutZoom={zoom}
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
                    Open a PDF, pinch to zoom, then double-click a line to park the
                    reading strip. Everything else sits under a 70% veil.
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
                    <div>Double-click a line to focus · <kbd>F</kbd> toggle · <kbd>T</kbd> pages</div>
                    <div><kbd>⌘</kbd><kbd>F</kbd> find · <kbd>[</kbd> <kbd>]</kbd> strip · <kbd>⌘[</kbd> <kbd>⌘]</kbd> ×2</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {pdf && focusMode && (
            <div className="focus-overlay" aria-hidden>
              <div className="focus-mask" ref={focusMaskTopRef} />
              <div className="focus-band" ref={focusBandRef} style={{ height: onScreenStrip }} />
              <div className="focus-mask" style={{ flex: 1 }} />
            </div>
          )}
        </div>
      </div>

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
