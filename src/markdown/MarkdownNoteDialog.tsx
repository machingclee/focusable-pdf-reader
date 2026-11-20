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
  type RefObject,
} from "react";
import { AlignLeft, Columns2, Eye } from "lucide-react";
import { MarkdownCodeEditor } from "./MarkdownCodeEditor";
import { MarkdownPreviewer } from "./MarkdownPreviewer";
import { useMarkdownShortcuts } from "./useMarkdownShortcuts";
import type { MonacoEditor } from "./monaco";
import { StripThumbnail, type BandSource } from "../components/StripThumbnail";
// KaTeX ships its own stylesheet plus the font files it needs; importing it
// here keeps both in the lazily-loaded dialog chunk instead of the app shell.
import "katex/dist/katex.min.css";
import "./markdown.css";

type ViewMode = "plain" | "mixed" | "preview";

const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 28;
const DEFAULT_FONT_SIZE = 16;
const MIN_SPLIT = 20;
const MAX_SPLIT = 80;

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
  stripPreview?: { path: string; band: BandSource } | null;
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
  onCancel,
  onSave,
}: MarkdownNoteDialogProps) {
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [mode, setMode] = useState<ViewMode>("mixed");
  const [split, setSplit] = useState(50);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [searchOpen, setSearchOpen] = useState(false);

  const editorRef = useRef<MonacoEditor | null>(null);
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const splitDragRef = useRef(false);

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
    setMarkdown((current) => {
      const escaped = cleanPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return current.replace(
        new RegExp(`(!\\[[^\\]]*\\]\\(${escaped})(?:\\?width=\\d+)?(\\))`, "g"),
        `$1?width=${newWidth}$2`,
      );
    });
  }, []);

  // ── Split drag ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!splitDragRef.current || !bodyRef.current) return;
      const rect = bodyRef.current.getBoundingClientRect();
      const ratio = ((event.clientX - rect.left) / rect.width) * 100;
      setSplit(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, ratio)));
    };
    const onUp = () => {
      if (!splitDragRef.current) return;
      splitDragRef.current = false;
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
              title="Editor only (⌘⌥B)"
              aria-pressed={mode === "plain"}
            >
              <AlignLeft size={15} />
              Edit
            </button>
            <button
              type="button"
              className={`note-mode${mode === "mixed" ? " is-active" : ""}`}
              onClick={() => setMode("mixed")}
              title="Editor + preview (⌘⌥B)"
              aria-pressed={mode === "mixed"}
            >
              <Columns2 size={15} />
              Split
            </button>
            <button
              type="button"
              className={`note-mode${mode === "preview" ? " is-active" : ""}`}
              onClick={() => setMode("preview")}
              title="Preview only (⌘B)"
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
          <div className="note-band">
            <StripThumbnail path={stripPreview.path} band={stripPreview.band} />
          </div>
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
            onMouseDown={(event) => {
              event.preventDefault();
              splitDragRef.current = true;
              document.body.style.userSelect = "none";
              document.body.style.cursor = "col-resize";
              window.getSelection()?.removeAllRanges();
            }}
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
            <kbd>⌘S</kbd> save · <kbd>Esc</kbd> cancel · <kbd>⌘B</kbd> preview ·{" "}
            <kbd>⌘⌥B</kbd> hide preview · <kbd>⌘F</kbd> find
          </span>
          <span className="note-foot-count">
            {markdown.trim() ? `${markdown.trim().split(/\s+/).length} words` : "Markdown supported: headings, lists, tables, math, code"}
          </span>
        </footer>
      </div>
    </div>
  );
}
