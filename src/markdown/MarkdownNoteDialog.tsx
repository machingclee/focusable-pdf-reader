/**
 * The note popup: a markdown editor for the strip being saved.
 *
 * Three view modes, same vocabulary as the shell-script-manager project this
 * was ported from:
 *
 *   plain    — editor only
 *   mixed    — editor and live preview side by side, draggable divider
 *   preview  — rendered preview only
 *
 * Two dividers, one per axis: the vertical one inside the panes trades editor
 * width for preview width, and the horizontal one under the strip preview trades
 * the page band for pane height. The note is read against the strip, so which of
 * the two deserves the room changes from page to page — hence both are draggable
 * rather than set by a breakpoint.
 *
 * The dialog owns the markdown string for its lifetime; the caller persists it
 * as the strip's `remark` when the user confirms. Both panes stay mounted in
 * every mode (switching is width/display only), so flipping to preview and back
 * does not lose Monaco's undo stack or the preview's scroll position.
 *
 * Divergence from the reference: the name field, the save-location dialog, the
 * draft/new-script concept and the HTML export are gone — a note belongs to the
 * strip being saved, so there is nothing to name or move.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { AlignLeft, Columns2, Eye } from "lucide-react";
import { MarkdownCodeEditor } from "./MarkdownCodeEditor";
import { MarkdownPreviewer } from "./MarkdownPreviewer";
import type { NoteReveal } from "../components/NoteReference";
import { SHORTCUT } from "../shortcutHints";
import { replaceImageWidth } from "./noteImages";
import { useMarkdownShortcuts } from "./useMarkdownShortcuts";
import type { MonacoEditor } from "./monaco";
import {
  bandResizeBounds,
  clampBandHeight,
  stripHeightAt,
  type BandBounds,
} from "../noteBandResize";
import { StripThumbnail, type BandSource } from "../components/StripThumbnail";
// KaTeX ships its own stylesheet plus the font files it needs; importing it
// here keeps both in the lazily-loaded dialog chunk instead of the app shell.
import "katex/dist/katex.min.css";
import "./markdown.css";

type ViewMode = "plain" | "mixed" | "preview";

/**
 * What a pointer drag is currently moving.
 *
 * The two dividers are independent (a drag picks one at mousedown and keeps it
 * until mouseup), but they share the window listeners and the body cursor, so
 * they share one state rather than one effect each.
 */
type Drag =
  | { kind: "split" }
  | { kind: "band"; startY: number; startHeight: number; bounds: BandBounds };

const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 28;
const DEFAULT_FONT_SIZE = 16;
const MIN_SPLIT = 20;
const MAX_SPLIT = 80;
/** One arrow key on the band divider, in CSS px. */
const BAND_KEY_STEP = 24;

export type MarkdownNoteDialogProps = {
  /** Heading, e.g. `Note for page 12`. */
  title: string;
  /** Secondary line: the document name the strip belongs to. */
  subtitle: string;
  /** Starting markdown (empty for a new note, the saved remark when editing). */
  initialMarkdown?: string;
  /**
   * The strip the note is about, drawn above the panes. This is the page band
   * the note refers to — the same thumbnail the Notes list shows — so the text
   * can be written with the passage in view instead of from memory.
   */
  stripPreview?: { path: string; band: BandSource; highlights?: string } | null;
  /**
   * The strip whose note this is, when it is a saved one. A `[note:<id>]`
   * reference in the text renders the note it names, and this is how the
   * preview knows not to follow a reference back into the note being edited.
   */
  noteId?: number | null;
  /** That strip's document, so a reference inside the same PDF names no document. */
  pdfDocumentId?: number | null;
  /**
   * Show the note a `[note:<id>]` reference in the preview points at.
   *
   * The preview renders the references of a saved note, and a reference there is
   * a way to the note it names, so the handler travels down to the previewer.
   */
  onRevealNote?: NoteReveal | null;
  /** True while the caller is posting the strip + note. */
  saving: boolean;
  /** Message from the caller when saving failed. */
  error: string | null;
  onCancel: () => void;
  /** Called with the note markdown when the user confirms. */
  onSave: (markdown: string) => void;
};

export function MarkdownNoteDialog({
  title,
  subtitle,
  initialMarkdown = "",
  saving,
  error,
  stripPreview,
  noteId = null,
  pdfDocumentId = null,
  onRevealNote = null,
  onCancel,
  onSave,
}: MarkdownNoteDialogProps) {
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [mode, setMode] = useState<ViewMode>("mixed");
  const [split, setSplit] = useState(50);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [searchOpen, setSearchOpen] = useState(false);
  /**
   * Height of the strip preview, in px, once the user has dragged the divider.
   * `null` is the untouched dialog: the band keeps its natural height, capped by
   * the stylesheet's `38vh`.
   */
  const [bandHeight, setBandHeight] = useState<number | null>(null);

  const editorRef = useRef<MonacoEditor | null>(null);
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const bandRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);

  // ── Editor → preview ──────────────────────────────────────────────────────
  /** Scroll the preview to the block rendered from `lineNumber`. */
  const scrollPreviewToLine = useCallback((lineNumber: number) => {
    const preview = previewBoxRef.current;
    if (!preview) return;
    const candidates = Array.from(preview.querySelectorAll<HTMLElement>("[data-source-line]"));
    let best: HTMLElement | null = null;
    for (const el of candidates) {
      const n = parseInt(el.getAttribute("data-source-line") ?? "0", 10);
      if (n <= lineNumber) best = el;
      else break;
    }
    if (!best) return;
    // Walk up to the nearest block-level element so inline nodes (e.g. <code>)
    // are not flashed in isolation — the whole line should highlight.
    const BLOCK_TAGS = new Set([
      "P",
      "LI",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
      "BLOCKQUOTE",
      "PRE",
      "TABLE",
      "TR",
      "TD",
      "TH",
    ]);
    let flashTarget: HTMLElement = best;
    while (flashTarget.parentElement && !BLOCK_TAGS.has(flashTarget.tagName)) {
      flashTarget = flashTarget.parentElement;
    }
    // `ul > li` is `position: relative` for the custom bullet, which makes
    // offsetTop 0 in WKWebView; measuring rects avoids the jump-to-top bug.
    const previewRect = preview.getBoundingClientRect();
    const targetRect = flashTarget.getBoundingClientRect();
    const offsetTop = targetRect.top - previewRect.top + preview.scrollTop;
    preview.scrollTop = Math.max(0, offsetTop - preview.clientHeight / 2);
    flashTarget.classList.remove("md-preview-flash");
    // Force reflow so removing then adding the class restarts the animation.
    void flashTarget.offsetWidth;
    flashTarget.classList.add("md-preview-flash");
    flashTarget.addEventListener(
      "animationend",
      () => flashTarget.classList.remove("md-preview-flash"),
      { once: true },
    );
  }, []);

  // ── Writing back to the markdown source ───────────────────────────────────
  /** Toggle the `index`-th `- [ ]` task item. */
  const onCheckboxToggle = useCallback((index: number) => {
    setMarkdown((current) => {
      const lines = current.split("\n");
      let seen = 0;
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^(\s*-\s+)\[([ xX])\](.*)$/);
        if (!match) continue;
        if (seen === index) {
          const checked = match[2].toLowerCase() === "x";
          lines[i] = `${match[1]}[${checked ? " " : "x"}]${match[3]}`;
          return lines.join("\n");
        }
        seen++;
      }
      return current;
    });
  }, []);

  /** Persist a dragged image width as a `?width=` suffix on its markdown src. */
  const onImageWidthChange = useCallback((cleanPath: string, newWidth: number) => {
    setMarkdown((current) => replaceImageWidth(current, cleanPath, newWidth));
  }, []);

  // ── Drags ─────────────────────────────────────────────────────────────────
  /**
   * The range the band divider may move into right now, measured from the live
   * layout: what the strip asks for at this width, and how much the panes can
   * spare. Read per gesture rather than cached, because a resize of the window
   * (or a re-painted strip) changes both numbers.
   */
  const measureBand = useCallback((): { height: number; bounds: BandBounds } | null => {
    const band = bandRef.current;
    const body = bodyRef.current;
    if (!band || !body) return null;
    const height = band.getBoundingClientRect().height;
    // How tall the strip actually is, taken from the paint's own pixels rather
    // than from the canvas' box: the box answers "how tall is the band's slot",
    // which is the number being dragged, whereas the backing store's width and
    // height are the strip's aspect ratio and survive any squeeze the layout
    // applies. 0 while nothing is painted, which `bandResizeBounds` reads as "no
    // ceiling known".
    const canvas = band.querySelector("canvas");
    const contentHeight =
      canvas && band.firstElementChild?.classList.contains("is-ready")
        ? stripHeightAt(canvas.clientWidth, canvas.width, canvas.height)
        : 0;
    return {
      height,
      bounds: bandResizeBounds({
        height,
        bodyHeight: body.getBoundingClientRect().height,
        contentHeight,
      }),
    };
  }, []);

  const beginDrag = useCallback((drag: Drag) => {
    dragRef.current = drag;
    document.body.style.userSelect = "none";
    document.body.style.cursor = drag.kind === "split" ? "col-resize" : "row-resize";
    window.getSelection()?.removeAllRanges();
  }, []);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === "split") {
        const body = bodyRef.current;
        if (!body) return;
        const rect = body.getBoundingClientRect();
        const ratio = ((event.clientX - rect.left) / rect.width) * 100;
        setSplit(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, ratio)));
        return;
      }
      setBandHeight(
        clampBandHeight(drag.startHeight + (event.clientY - drag.startY), drag.bounds),
      );
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onSplitMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      beginDrag({ kind: "split" });
    },
    [beginDrag],
  );

  /** Grab the band's divider: from here the pointer's Y is the band's height. */
  const onBandMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const measured = measureBand();
      if (!measured) return;
      beginDrag({
        kind: "band",
        startY: event.clientY,
        startHeight: measured.height,
        bounds: measured.bounds,
      });
    },
    [beginDrag, measureBand],
  );

  /** Arrow keys nudge the band so the divider is reachable without a drag. */
  const onBandKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step =
        event.key === "ArrowUp" ? -BAND_KEY_STEP : event.key === "ArrowDown" ? BAND_KEY_STEP : 0;
      if (!step) return;
      const measured = measureBand();
      if (!measured) return;
      event.preventDefault();
      setBandHeight(clampBandHeight(measured.height + step, measured.bounds));
    },
    [measureBand],
  );

  /** Back to the dialog's own default share (`38vh`, capped by the stylesheet). */
  const resetBandHeight = useCallback(() => setBandHeight(null), []);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const requestSave = useCallback(() => {
    if (saving) return;
    onSave(markdown);
  }, [markdown, onSave, saving]);

  useMarkdownShortcuts({
    onSave: requestSave,
    onClose: onCancel,
    onFind: () => {
      // ⌘F is useful in both halves: Monaco's own find widget while editing,
      // the preview search once the preview is on screen.
      if (mode === "plain") {
        editorRef.current?.trigger("", "actions.find", null);
        return;
      }
      editorRef.current?.trigger("", "actions.find", null);
      setSearchOpen(true);
    },
    onEscape: () => {
      if (searchOpen) {
        setSearchOpen(false);
        return;
      }
      onCancel();
    },
    onZoomIn: () => setFontSize((size) => Math.min(MAX_FONT_SIZE, size + 2)),
    onZoomOut: () => setFontSize((size) => Math.max(MIN_FONT_SIZE, size - 2)),
    onZoomReset: () => setFontSize(DEFAULT_FONT_SIZE),
    onToggleView: () => setMode((current) => (current === "preview" ? "mixed" : "preview")),
    onTogglePreviewPanel: () => setMode((current) => (current === "mixed" ? "plain" : "mixed")),
  });

  // The hidden editor must not keep the caret: typing in "preview" would edit
  // text nobody can see.
  useEffect(() => {
    if (mode !== "preview") return;
    editorRef.current?.getDomNode()?.blur();
  }, [mode]);

  const editorWidth = mode === "plain" ? "100%" : mode === "mixed" ? `${split}%` : "0%";
  const previewWidth = mode === "preview" ? "100%" : mode === "mixed" ? `${100 - split}%` : "0%";

  return (
    <div className="note-backdrop">
      <div
        className="note-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="note-head">
          <div className="note-head-titles">
            <div className="note-title">{title}</div>
            <div className="note-subtitle" title={subtitle}>
              {subtitle}
            </div>
          </div>

          <div className="note-modes" role="group" aria-label="View mode">
            <button
              type="button"
              className={`note-mode${mode === "plain" ? " is-active" : ""}`}
              onClick={() => setMode("plain")}
              title={`Editor only (${SHORTCUT.chord(SHORTCUT.mod, SHORTCUT.alt, "B")})`}
              aria-pressed={mode === "plain"}
            >
              <AlignLeft size={15} />
              Edit
            </button>
            <button
              type="button"
              className={`note-mode${mode === "mixed" ? " is-active" : ""}`}
              onClick={() => setMode("mixed")}
              title={`Editor + preview (${SHORTCUT.chord(SHORTCUT.mod, SHORTCUT.alt, "B")})`}
              aria-pressed={mode === "mixed"}
            >
              <Columns2 size={15} />
              Split
            </button>
            <button
              type="button"
              className={`note-mode${mode === "preview" ? " is-active" : ""}`}
              onClick={() => setMode("preview")}
              title={`Preview only (${SHORTCUT.chord(SHORTCUT.mod, "B")})`}
              aria-pressed={mode === "preview"}
            >
              <Eye size={15} />
              Preview
            </button>
          </div>

          <div className="note-actions">
            <button type="button" className="note-btn" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="note-btn is-primary"
              onClick={requestSave}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save note"}
            </button>
          </div>
        </header>

        {error && (
          <div className="note-error" role="alert">
            {error}
          </div>
        )}

        {stripPreview && (
          <>
            <div
              className={`note-band${bandHeight === null ? "" : " is-sized"}`}
              ref={bandRef}
              style={bandHeight === null ? undefined : { height: `${bandHeight}px` }}
            >
              <StripThumbnail
                path={stripPreview.path}
                band={stripPreview.band}
                highlights={stripPreview.highlights}
              />
            </div>
            <div
              className="note-band-split"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize the strip preview"
              title="Drag up or down to resize the preview · double-click to reset"
              tabIndex={0}
              onMouseDown={onBandMouseDown}
              onDoubleClick={resetBandHeight}
              onKeyDown={onBandKeyDown}
            />
          </>
        )}

        <div className="note-body" ref={bodyRef}>
          <div
            className="note-edit"
            style={{ width: editorWidth, display: mode === "preview" ? "none" : undefined }}
          >
            <MarkdownCodeEditor
              content={markdown}
              fontSize={fontSize}
              editorRef={editorRef as RefObject<MonacoEditor | null>}
              onChange={setMarkdown}
              onRevealInPreview={scrollPreviewToLine}
            />
          </div>
          <div
            className="note-split"
            style={{ display: mode === "mixed" ? undefined : "none" }}
            onMouseDown={onSplitMouseDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panes"
          />
          <div
            className="note-preview"
            style={{ width: previewWidth, display: mode === "plain" ? "none" : undefined }}
          >
            <MarkdownPreviewer
              content={markdown}
              fontSize={fontSize}
              noteId={noteId}
              pdfDocumentId={pdfDocumentId}
              onRevealNote={onRevealNote}
              previewBoxRef={previewBoxRef}
              editorRef={editorRef as RefObject<MonacoEditor | null>}
              onImageWidthChange={onImageWidthChange}
              onCheckboxToggle={onCheckboxToggle}
              searchOpen={searchOpen}
              searchInputRef={searchInputRef}
              onSearchClose={() => setSearchOpen(false)}
            />
          </div>
        </div>

        <footer className="note-foot">
          <span>
            <kbd>{SHORTCUT.chord(SHORTCUT.mod, "S")}</kbd> save · <kbd>Esc</kbd> cancel ·{" "}
            <kbd>{SHORTCUT.chord(SHORTCUT.mod, "B")}</kbd> preview ·{" "}
            <kbd>{SHORTCUT.chord(SHORTCUT.mod, SHORTCUT.alt, "B")}</kbd> hide preview ·{" "}
            <kbd>{SHORTCUT.chord(SHORTCUT.mod, "F")}</kbd> find
          </span>
          <span className="note-foot-count">
            {markdown.trim() ? `${markdown.trim().split(/\s+/).length} words` : "Markdown supported: headings, lists, tables, math, code"}
          </span>
        </footer>
      </div>
    </div>
  );
}
