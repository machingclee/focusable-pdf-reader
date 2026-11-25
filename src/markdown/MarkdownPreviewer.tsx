/**
 * The rendered half of the note dialog.
 *
 * Ported from the shell-script-manager project's `MarkdownPreviewer`, keeping
 * the parse pipeline and the rendered affordances but dropping everything tied
 * to that app:
 *
 *   - presentation mode (per-block reveal on Enter/Backspace) — a reading-note
 *     preview is not a slide deck;
 *   - the dark/light preview toggle and every `previewDarkMode ? … : …` branch:
 *     this app only has a dark theme, so the dark side of each branch is now
 *     plain CSS in `markdown.css`;
 *   - `[item#ID]` cross-references to other scripts, and the shell-block
 *     "Execute" context menu — this app has neither scripts nor a runner;
 *   - the toast system and MUI (`Box` + `sx`), replaced by local state and
 *     stylesheet rules.
 *
 * Kept as-is: GFM + math + syntax highlighting + raw HTML, heading anchors, the
 * inline `[TOC]` block and the scroll-out contents sidebar, preview search,
 * source-line tagging (double-click jumps to the matching editor line),
 * resizable images, click-to-copy code and inline code, task-list checkboxes,
 * and the image-only paragraph rule.
 *
 * One substitution: the reference rendered math with `rehype-mathjax`, whose
 * `mathjax-full` backing is CommonJS. Vite's dev server has to pre-bundle that
 * by hand and kept failing mid-session ("require is not defined" on a stale
 * optimized chunk), so math now goes through `rehype-katex`. The markdown side
 * is unchanged — `remark-math` still owns the `$…$` / `$$…$$` parsing — only the
 * renderer differs, and it drops roughly 5 MB from the note chunk.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import * as monaco from "monaco-editor";
import { Check, Copy, ListTree } from "lucide-react";
import { isExternalHref, openExternalLink } from "./links";
import { extractHeadingsFromMd, fenceText, rehypeHeadingIds, type HastNode, type Heading } from "./toc";
import type { MonacoEditor } from "./monaco";
import { rehypeNoteReferences } from "../noteReference";
import { NoteScopeProvider, noteRefComponents, type NoteReveal } from "../components/NoteReference";
import { noteImagePath, noteImageSrc, useImagesDir } from "./noteImages";
import { ResizableImage } from "./ResizableImage";

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE_FONT_SIZE = 18;
const BASE_CONTENT_WIDTH = 860;
const TOC_SIDEBAR_MIN_WIDTH = 140;
const TOC_SIDEBAR_MAX_WIDTH = 480;
const TOC_SIDEBAR_DEFAULT_WIDTH = 320;
/** How far above the viewport top a heading still counts as "current". */
const TOC_ACTIVE_LEAD = 100;

// ─── Rehype passes ───────────────────────────────────────────────────────────

/**
 * Stamp every element with the source line that produced it, so a double-click
 * in the preview can find the matching line in the editor.
 */
function rehypeAddSourceLines() {
  return (tree: HastNode) => {
    function walk(node: HastNode & { position?: { start?: { line?: number } } }) {
      if (node.type === "element" && node.position?.start?.line != null) {
        node.properties = node.properties ?? {};
        node.properties["data-source-line"] = String(node.position.start.line);
      }
      if (node.children) {
        for (const child of node.children) walk(child);
      }
    }
    walk(tree);
  };
}

/**
 * Split preview text nodes on the search query and wrap the hits in `<mark>`.
 * Done as a rehype pass (rather than by manipulating the DOM afterwards) so the
 * marks survive re-renders and never fight React for ownership of the nodes.
 */
function makeRehypeSearchHighlight(query: string) {
  const q = query.trim().toLowerCase();
  return function rehypeSearchHighlight() {
    return function transformer(tree: HastNode) {
      if (!q) return;
      function visitNode(node: HastNode): HastNode[] | null {
        if (node.type === "text") {
          const value = node.value ?? "";
          const lower = value.toLowerCase();
          if (!lower.includes(q)) return null;
          const parts: HastNode[] = [];
          let pos = 0;
          while (true) {
            const found = lower.indexOf(q, pos);
            if (found === -1) {
              if (pos < value.length) parts.push({ type: "text", value: value.slice(pos) });
              break;
            }
            if (found > pos) parts.push({ type: "text", value: value.slice(pos, found) });
            parts.push({
              type: "element",
              tagName: "mark",
              properties: { className: ["search-mark"] },
              children: [{ type: "text", value: value.slice(found, found + q.length) }],
            });
            pos = found + q.length;
          }
          return parts;
        }
        if (node.children) {
          const newChildren: HastNode[] = [];
          let changed = false;
          for (const child of node.children) {
            const result = visitNode(child);
            if (result !== null) {
              newChildren.push(...result);
              changed = true;
            } else {
              newChildren.push(child);
            }
          }
          if (changed) node.children = newChildren;
        }
        return null;
      }
      visitNode(tree);
    };
  };
}

// ─── Renderer helpers ────────────────────────────────────────────────────────

/**
 * react-markdown hands each renderer the parsed `node` alongside the real DOM
 * props. Spreading it onto an element makes React warn about an unknown prop on
 * every render, so it is stripped here once instead of at every call site.
 */
function withoutNode<T extends object>(props: T): Omit<T, "node"> {
  const { node, ...rest } = props as T & { node?: unknown };
  void node;
  return rest;
}


// ─── Search bar ──────────────────────────────────────────────────────────────

function SearchBar({
  query,
  onQueryChange,
  matchCount,
  matchIdx,
  inputRef,
  onAdvance,
  onClose,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  matchCount: number;
  matchIdx: number;
  inputRef: RefObject<HTMLInputElement | null>;
  onAdvance: () => void;
  onClose: () => void;
}) {
  return (
    <div className="md-search">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onAdvance();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder="Search note…"
        aria-label="Search note"
      />
      <span className="md-search-count">
        {query.trim() ? (matchCount > 0 ? `${matchIdx + 1}/${matchCount}` : "0/0") : ""}
      </span>
      <button type="button" className="md-search-close" onMouseDown={(e) => {
        e.preventDefault();
        onClose();
      }} aria-label="Close search">
        ✕
      </button>
    </div>
  );
}

// ─── Contents list ───────────────────────────────────────────────────────────

function TocList({
  headings,
  previewBoxRef,
  wrap = false,
  activeId = null,
}: {
  headings: Heading[];
  previewBoxRef: RefObject<HTMLDivElement | null>;
  /** Wrap long headings instead of letting them widen the list. */
  wrap?: boolean;
  /** Heading whose top edge has reached the top of the viewport. */
  activeId?: string | null;
}) {
  const minLevel = Math.min(...headings.map((heading) => heading.level));

  // Renderers for inline markdown inside a contents link. `p` and `a` are
  // unwrapped: a contents item is already a link, so a nested <a> is invalid.
  const tocInlineComponents = useMemo<Components>(
    () => ({
      p: ({ children }) => <>{children}</>,
      a: ({ children }) => <>{children}</>,
    }),
    [],
  );

  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!activeId || !listRef.current) return;
    let item: HTMLElement | null = null;
    try {
      item = listRef.current.querySelector<HTMLElement>(`[data-toc-id="${CSS.escape(activeId)}"]`);
    } catch {
      return;
    }
    item?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  return (
    <ul className="md-toc-list" ref={listRef}>
      {headings.map((heading, index) => (
        <li
          key={index}
          data-toc-id={heading.id}
          className={`md-toc-item${heading.id === activeId ? " is-active" : ""}${wrap ? " is-wrapped" : ""}`}
          style={{ paddingLeft: `${(heading.level - minLevel) * 16}px` }}
        >
          <a
            href={`#${heading.id}`}
            onClick={(event) => {
              event.preventDefault();
              const container = previewBoxRef.current;
              if (!container) return;
              let el: Element | null = null;
              try {
                el = container.querySelector(`#${CSS.escape(heading.id)}`);
              } catch {
                return;
              }
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            <ReactMarkdown components={tocInlineComponents}>{heading.text}</ReactMarkdown>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The `[TOC]` block, rendered inline where the marker sits. */
function InlineTableOfContents({
  headings,
  previewBoxRef,
}: {
  headings: Heading[];
  previewBoxRef: RefObject<HTMLDivElement | null>;
}) {
  if (headings.length === 0) return null;
  return (
    <div className="md-inline-toc" data-inline-toc="">
      <div className="md-inline-toc-title">Contents</div>
      <TocList headings={headings} previewBoxRef={previewBoxRef} />
    </div>
  );
}

// ─── Code blocks ─────────────────────────────────────────────────────────────

function MarkdownCodeBlock({
  text,
  children,
}: {
  text: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copy = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
      },
      () => {
        // Clipboard writes can be refused (no user gesture, permissions); the
        // button simply does not claim success.
        setCopied(false);
      },
    );
  };

  return (
    <div className="md-code-block">
      <button
        type="button"
        className="md-code-copy"
        title={copied ? "Copied" : "Copy"}
        aria-label={copied ? "Copied" : "Copy code"}
        onMouseDown={(event) => {
          if (event.button === 0) event.preventDefault();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={copy}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy"}
      </button>
      {children}
    </div>
  );
}

// ─── Previewer ───────────────────────────────────────────────────────────────

export type MarkdownPreviewerProps = {
  /** Markdown source to render. */
  content: string;
  /** Preview body font size in px. */
  fontSize: number;
  /**
   * The strip this note belongs to, when the preview is of a saved note.
   *
   * A `[note:<id>]` reference renders the note it names, so the preview needs to
   * know which note it is inside: a note that references itself is not followed.
   */
  noteId?: number | null;
  /** That strip's document, so a reference inside the same PDF names no document. */
  pdfDocumentId?: number | null;
  /**
   * Show the note a `[note:<id>]` reference points at.
   *
   * The preview is a place where a note is read, so a reference must answer here
   * the way it answers in a card: the host opens a window of its own for that
   * note. Without the handler a reference stays a thing to read.
   */
  onRevealNote?: NoteReveal | null;
  /** Populated with the scrollable preview container. */
  previewBoxRef: RefObject<HTMLDivElement | null>;
  /** The sibling editor, used for preview → editor jumps. Null in preview-only mode. */
  editorRef: RefObject<MonacoEditor | null>;
  /** Called when the user drags an image wider/narrower. */
  onImageWidthChange: (cleanPath: string, newWidth: number) => void;
  /** Called when the user ticks a task-list checkbox. */
  onCheckboxToggle: (index: number) => void;
  /** Whether the search bar is open. Controlled by the dialog. */
  searchOpen: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onSearchClose: () => void;
};

export function MarkdownPreviewer({
  content,
  fontSize,
  noteId = null,
  pdfDocumentId = null,
  onRevealNote = null,
  previewBoxRef,
  editorRef,
  onImageWidthChange,
  onCheckboxToggle,
  searchOpen,
  searchInputRef,
  onSearchClose,
}: MarkdownPreviewerProps) {
  // Where `images/<file>` pictures live. Null until the shell answers, and a
  // relative src is used until then — the same string the remark stores.
  const imagesDir = useImagesDir();
  // ── Preview search ────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIdx, setSearchIdx] = useState(0);
  const [searchCount, setSearchCount] = useState(0);

  useEffect(() => {
    if (!searchOpen) {
      setSearchQuery("");
      setSearchIdx(0);
    }
  }, [searchOpen]);

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [searchOpen, searchInputRef]);

  useLayoutEffect(() => {
    if (!searchOpen || !searchQuery.trim()) {
      setSearchCount(0);
      return;
    }
    const container = previewBoxRef.current;
    if (!container) return;
    const marks = Array.from(container.querySelectorAll<HTMLElement>("mark.search-mark"));
    setSearchCount(marks.length);
    if (marks.length === 0) return;
    const index = searchIdx % marks.length;
    marks.forEach((mark, i) => {
      mark.classList.toggle("is-current", i === index);
    });
    marks[index].scrollIntoView({ block: "center" });
  }, [searchIdx, searchOpen, searchQuery, content, previewBoxRef]);

  // ── Contents sidebar ──────────────────────────────────────────────────────
  // Appears once the inline [TOC] block scrolls out of view.
  const [tocAvailable, setTocAvailable] = useState(false);
  const [tocActiveId, setTocActiveId] = useState<string | null>(null);
  const [tocWidth, setTocWidth] = useState(TOC_SIDEBAR_DEFAULT_WIDTH);
  const tocWidthRef = useRef(TOC_SIDEBAR_DEFAULT_WIDTH);
  tocWidthRef.current = tocWidth;
  const tocDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  // A manual collapse stays until the contents control is clicked again.
  const [tocCollapsed, setTocCollapsed] = useState(false);

  const headings = useMemo(() => extractHeadingsFromMd(content), [content]);
  const tocAvailableRef = useRef(false);

  useEffect(() => {
    const container = previewBoxRef.current;
    if (!container) return;
    const update = () => {
      const toc = container.querySelector<HTMLElement>("[data-inline-toc]");
      const containerTop = container.getBoundingClientRect().top;
      // Distance of the inline contents' bottom edge from the viewport top:
      // 0 means flush with it, negative means it has scrolled past.
      const scrolledOut = !!toc && toc.getBoundingClientRect().bottom - containerTop < 0;
      // Setting state on every scroll re-renders the preview, which fires the
      // observer again, so only publish the value when it changes.
      if (scrolledOut !== tocAvailableRef.current) {
        tocAvailableRef.current = scrolledOut;
        setTocAvailable(scrolledOut);
      }
      if (!toc) return;

      // The current section is the last heading within the lead distance of the
      // viewport top, so the highlight moves before the heading arrives.
      let activeId: string | null = null;
      for (const heading of headings) {
        let el: HTMLElement | null = null;
        try {
          el = container.querySelector<HTMLElement>(`#${CSS.escape(heading.id)}`);
        } catch {
          continue;
        }
        if (!el) continue;
        if (el.getBoundingClientRect().top - containerTop <= TOC_ACTIVE_LEAD) activeId = heading.id;
        else break;
      }
      setTocActiveId(activeId);
    };
    update();
    // ReactMarkdown renders after this effect, so the first measurement finds
    // nothing. Watch the container and measure again once it appears.
    const observer = new MutationObserver(update);
    observer.observe(container, { childList: true, subtree: true });
    container.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [previewBoxRef, content, headings]);

  const onTocResizeMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    tocDragRef.current = { startX: event.clientX, startWidth: tocWidthRef.current };
    const onMove = (moveEvent: MouseEvent) => {
      if (!tocDragRef.current) return;
      const next = tocDragRef.current.startWidth + (moveEvent.clientX - tocDragRef.current.startX);
      setTocWidth(
        Math.min(TOC_SIDEBAR_MAX_WIDTH, Math.max(TOC_SIDEBAR_MIN_WIDTH, Math.round(next))),
      );
    };
    const onUp = () => {
      tocDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // ── Preview → editor ──────────────────────────────────────────────────────
  const flashDecorationsRef = useRef<string[]>([]);

  const handlePreviewDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      let el = event.target as HTMLElement | null;
      while (el) {
        const lineAttr = el.getAttribute("data-source-line");
        if (lineAttr) {
          const lineNumber = Math.max(1, parseInt(lineAttr, 10));
          const editor = editorRef.current;
          if (editor) {
            editor.revealLineInCenter(lineNumber);
            editor.setPosition({ lineNumber, column: 1 });
            editor.focus();
            flashDecorationsRef.current = editor.deltaDecorations(flashDecorationsRef.current, [
              {
                range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                options: { isWholeLine: true, className: "md-editor-line-flash" },
              },
            ]);
            window.setTimeout(() => {
              flashDecorationsRef.current = editor.deltaDecorations(
                flashDecorationsRef.current,
                [],
              );
            }, 700);
          }
          break;
        }
        el = el.parentElement;
      }
    },
    [editorRef],
  );

  // ── Markdown components ───────────────────────────────────────────────────
  // Typed as `Components` so every renderer receives the real DOM prop types;
  // `withoutNode` strips react-markdown's `node` before anything is spread onto
  // an element.
  const markdownComponents = useMemo<Components>(
    () => ({
      // The nested note a `[note:<id>]` reference becomes. A module constant, so
      // it costs this memo nothing and reads the same as in a note card.
      ...noteRefComponents,
      a: ({ href, children, ...rest }) => {
        const external = isExternalHref(href);
        return (
          <a
            {...withoutNode(rest)}
            href={href}
            onClick={(event) => {
              if (!external) return;
              event.preventDefault();
              event.stopPropagation();
              void openExternalLink(href as string).catch(console.error);
            }}
          >
            {children}
          </a>
        );
      },
      p: ({ children, node, ...rest }) => {
        const nodeChildren = (node as HastNode | undefined)?.children ?? [];
        // A paragraph that contains nothing but an image would otherwise get
        // the body's paragraph margins on top of the image's own.
        const isOnlyImage =
          nodeChildren.length === 1 &&
          nodeChildren[0].type === "element" &&
          nodeChildren[0].tagName === "img";
        if (isOnlyImage) {
          return (
            <div {...withoutNode(rest)} className="md-image-paragraph">
              {children}
            </div>
          );
        }
        // A lonely `[TOC]` marker is replaced by the generated contents block.
        const isToc =
          nodeChildren.length === 1 &&
          nodeChildren[0].type === "text" &&
          nodeChildren[0].value?.trim() === "[TOC]";
        if (isToc) {
          return <InlineTableOfContents headings={headings} previewBoxRef={previewBoxRef} />;
        }
        return <p {...withoutNode(rest)}>{children}</p>;
      },
      img: ({ src, alt }) => {
        const { cleanPath, width: initialWidth } = noteImagePath(src ?? "");
        return (
          <ResizableImage
            src={noteImageSrc(cleanPath, imagesDir)}
            alt={alt ?? ""}
            initialWidth={initialWidth}
            onWidthChange={(newWidth) => onImageWidthChange(cleanPath, newWidth)}
          />
        );
      },
      pre: ({ children, node, ...rest }) => {
        const codeNode = Array.isArray((node as HastNode | undefined)?.children)
          ? (node as HastNode).children!.find(
              (child) => child.type === "element" && child.tagName === "code",
            )
          : undefined;
        const text = fenceText(codeNode ?? (node as HastNode | undefined));
        return (
          <MarkdownCodeBlock text={text}>
            <pre {...withoutNode(rest)}>{children}</pre>
          </MarkdownCodeBlock>
        );
      },
      code: ({ children, className, ...rest }) => {
        // No language class means inline code, not a fenced block.
        if (!className) {
          const text = typeof children === "string" ? children : "";
          return (
            <code
              {...withoutNode(rest)}
              className="md-inline-code"
              title="Click to copy"
              onClick={(event) => {
                event.stopPropagation();
                void navigator.clipboard.writeText(text);
              }}
            >
              {children}
            </code>
          );
        }
        return (
          <code {...withoutNode(rest)} className={className}>
            {children}
          </code>
        );
      },
      details: ({ children, open, ...rest }) => (
        <details
          {...withoutNode(rest)}
          // React 19 supports defaultOpen on <details>, but @types/react only
          // types the controlled `open` prop.
          {...({ defaultOpen: open != null && open !== false } as Record<string, unknown>)}
        >
          {children}
        </details>
      ),
      summary: ({ children, ...rest }) => <summary {...withoutNode(rest)}>{children}</summary>,
      input: ({ type, checked, ...rest }) => {
        if (type !== "checkbox") return <input {...withoutNode(rest)} type={type} />;
        return (
          <input
            {...withoutNode(rest)}
            type="checkbox"
            checked={!!checked}
            disabled={false}
            onChange={(event) => {
              event.stopPropagation();
              // The note source is a flat string, so a checkbox is identified by
              // its position among all checkboxes in the preview — which is the
              // same order the task-list lines appear in the markdown.
              const target = event.target;
              const container: Element | Document = previewBoxRef.current ?? document;
              const allCheckboxes = container.querySelectorAll('input[type="checkbox"]');
              let index = -1;
              for (let i = 0; i < allCheckboxes.length; i++) {
                if (allCheckboxes[i] === target) {
                  index = i;
                  break;
                }
              }
              if (index !== -1) onCheckboxToggle(index);
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          />
        );
      },
    }),
    [headings, imagesDir, onCheckboxToggle, onImageWidthChange, previewBoxRef],
  );

  // ── Plugins ───────────────────────────────────────────────────────────────
  const searchHighlightPlugin = useMemo(() => makeRehypeSearchHighlight(searchQuery), [searchQuery]);
  const rehypePlugins = useMemo(
    () =>
      [
        rehypeRaw,
        rehypeHighlight,
        rehypeKatex,
        // After KaTeX and before the two passes that only tag elements: a
        // reference in prose becomes its card here, and one in a fence never
        // reaches this pass at all (a fence's content is a `code` node).
        rehypeNoteReferences,
        rehypeAddSourceLines,
        rehypeHeadingIds,
        searchHighlightPlugin,
      ],
    [searchHighlightPlugin],
  );
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);

  const tocReady = tocAvailable && headings.length > 0;
  // A manual hide wins over the scroll-out rule. The list stays closed until
  // the icon is clicked, even after the inline contents leaves the viewport.
  const showTocSidebar = tocReady && !tocCollapsed;

  return (
    <div className="md-preview-shell">
      {tocReady && tocCollapsed && (
        <button
          type="button"
          className="md-toc-expand"
          onClick={() => setTocCollapsed(false)}
          title="Show contents"
          aria-expanded={false}
        >
          <ListTree size={15} />
        </button>
      )}
      {showTocSidebar && (
        <aside className="md-toc" style={{ width: tocWidth }}>
          <button
            type="button"
            className="md-toc-head"
            onClick={() => setTocCollapsed(true)}
            title="Hide contents"
            aria-expanded
          >
            <ListTree size={15} />
            <span className="md-toc-head-label">Contents</span>
          </button>
          <div className="md-toc-body">
            <div className="md-toc-scroll">
              <TocList
                headings={headings}
                previewBoxRef={previewBoxRef}
                wrap
                activeId={tocActiveId}
              />
            </div>
            <div
              className="md-toc-resizer"
              onMouseDown={onTocResizeMouseDown}
              title="Drag to resize"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize contents"
            />
          </div>
        </aside>
      )}
      <div className="md-preview-wrap">
        {searchOpen && (
          <SearchBar
            query={searchQuery}
            onQueryChange={setSearchQuery}
            matchCount={searchCount}
            matchIdx={searchIdx}
            inputRef={searchInputRef}
            onAdvance={() =>
              setSearchIdx((i) => (searchCount === 0 ? 0 : (i + 1) % searchCount))
            }
            onClose={onSearchClose}
          />
        )}
        <div
          ref={previewBoxRef}
          className="md-preview"
          onDoubleClick={handlePreviewDoubleClick}
          style={{ fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.6)}px` }}
        >
          <div
            className="md-doc"
            style={{ maxWidth: `${Math.round((BASE_CONTENT_WIDTH * fontSize) / BASE_FONT_SIZE)}px` }}
          >
            {/* The note being previewed, named so a reference back to it is not
                followed — the reader is already reading it. */}
            <NoteScopeProvider noteId={noteId} pdfDocumentId={pdfDocumentId} revealNote={onRevealNote}>
              <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
                components={markdownComponents}
              >
                {content}
              </ReactMarkdown>
            </NoteScopeProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
