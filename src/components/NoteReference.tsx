/**
 * The note a `[note:<id>]` reference points at.
 *
 * A reference is how one note says "see also that strip": the reader copies it
 * from any note's menu and pastes it into another note's markdown, and this
 * component is what that text becomes — the referenced strip drawn as a nested
 * note: its band of the PDF, its remark when it has one, and its page at the
 * foot. The card is the ordinary note card's shape, so the two read alike; the
 * only difference is the band, which is the reference's own way of saying which
 * passage is meant.
 *
 * Three things make it a component rather than a lookup in the list on screen:
 *
 *  - the note it points at may belong to another document, whose strips are not
 *    loaded here at all, so the id is resolved on its own through RTK Query
 *    (`GET /notes/:id`);
 *  - the same id is rendered from cards, from the note popup and from the
 *    popped-out window, and RTK Query is what makes those one request and one
 *    cache entry, refreshed by the per-id tag when the note is edited;
 *  - a note can reference one that references it back. There is no cycle to
 *    break in the data, so the chain of ids a render is *inside* is carried down
 *    through a context and a repeated id is drawn as a line of text instead of
 *    being followed again.
 *
 * Where a list is on screen, the reference is also a way there: clicking it asks
 * its host to show that note. In the viewer that is the note badge's own action
 * (`App`'s `openRemark`) — the notes column comes forward, the card's folder
 * opens, and the card is marked and scrolled to; in the Dashboard tab it is the rail
 * selecting the document that holds the note, after which the same reveal
 * happens in the list beside it. The request travels down as
 * `NoteScope.revealNote`; where no list can answer it (the note popup's preview)
 * the handler is absent and a reference is only read.
 *
 * The nested text is rendered with the card pipeline (GFM + math + KaTeX), the
 * same one `MarkdownNote` uses, so a nested note reads identically in a card and
 * in the editor's preview instead of depending on which host drew it.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { StickyNote } from "lucide-react";
import { noteApi } from "../store/api/noteApi";
import { noteSummary } from "../notesText";
import {
  NOTE_REFERENCE_TAG,
  clampNoteReferenceWidth,
  noteReferenceIdOf,
  noteReferenceIsBlock,
  clearNoteReferenceWidth,
  noteReferenceWidthOf,
  rehypeNoteReferences,
  replaceNoteReferenceWidth,
} from "../noteReference";
import {
  NoteScopeProvider,
  useNoteScope,
  type AnnotationReveal,
  type NoteReveal,
  type NoteScope,
} from "./noteScope";
import { AnnotationReferenceElement } from "./annotation/AnnotationReference";
import { ANNOTATION_REFERENCE_TAG, rehypeAnnotationReferences } from "../annotationReference";
import { ContextMenu } from "./ContextMenu";
import { ImageResizeProvider, NoteImage } from "../markdown/NoteImage";
import { replaceImageWidth } from "../markdown/noteImages";
import type { HastNode } from "../markdown/toc";
import { StripThumbnail } from "./StripThumbnail";
// The math in a nested note needs the same stylesheet the note itself does.
import "katex/dist/katex.min.css";

/* ── The chain of notes being rendered ───────────────────────────────────── */

/**
 * The scope itself lives in `noteScope.tsx`, next to the annotation reference that
 * also reads it; it is re-exported here because every host of a note's markdown
 * already imports it from this file.
 */
export { NoteScopeProvider, useNoteScope };
export type { AnnotationReveal, NoteReveal, NoteScope };

/* ── The card ─────────────────────────────────────────────────────────────── */

/**
 * The component `react-markdown` renders `<note-ref>` with.
 *
 * The id and the block/inline decision travel on the element's properties, which
 * the pass in `noteReference.ts` set: keeping them on the node means the
 * renderer needs no closures of its own, so the components map is a module
 * constant every host can share.
 */
export function NoteReferenceElement({ node }: { node?: unknown }) {
  const element = node as HastNode | undefined;
  const id = noteReferenceIdOf(element);
  if (id === null) return null;
  return <NoteReference id={id} block={noteReferenceIsBlock(element)} width={noteReferenceWidthOf(element)} />;
}

/**
 * The extra renderers a note's markdown needs. Spread it into `components`.
 *
 * References become the nested card. A pasted picture's `images/` src is
 * resolved here too, so a card and a note inside a note show it. A host that
 * draws the picture itself (the popup preview, which can resize it) overrides
 * `img` after the spread.
 */
export const noteRefComponents = {
  [NOTE_REFERENCE_TAG]: NoteReferenceElement,
  [ANNOTATION_REFERENCE_TAG]: AnnotationReferenceElement,
  img: NoteImage,
} as unknown as Components;

/**
 * How far the pointer must travel before a press is a resize.
 *
 * A click jitters by a pixel or two. Below this distance the press is a click
 * and opens the note; past it the drag owns the gesture and the click does not
 * also open a window. The same distance a card waits before it is picked up.
 */
const RESIZE_DISTANCE_PX = 6;

/**
 * The nested note's box, dragged the way a picture in a note is.
 *
 * Right or up grows it, left or down shrinks it, and the drag stops at the
 * column it sits in. A press that does not travel is still a click, so the card
 * opens the note it names. The width is reported on mouse-up, and only when the
 * pointer actually dragged, so the reference can store it as `?width=`.
 */
function NoteRefFrame({
  width,
  onWidthChange,
  className,
  onClick,
  children,
  ...rest
}: {
  width: number | null;
  onWidthChange?: (width: number) => void;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"article">, "children">) {
  const frameRef = useRef<HTMLElement>(null);
  const [widthPx, setWidthPx] = useState<number | null>(width);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    x: number;
    y: number;
    w: number;
    ceiling: number | null;
    resizing: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    setWidthPx(width);
  }, [width]);

  useEffect(
    () => () => {
      if (dragRef.current?.resizing) document.body.classList.remove("is-resizing-note");
    },
    [],
  );

  const onMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    if (!onWidthChange || event.button !== 0) return;
    const frame = frameRef.current;
    // A picture, a nested note, or a control inside this card keeps the press.
    const owner =
      event.target instanceof Element
        ? event.target.closest(".md-image, .note-ref, a, button, input, select, textarea")
        : null;
    if (owner && owner !== frame) return;
    event.stopPropagation();
    const currentWidth = frame?.getBoundingClientRect().width || widthPx || 240;
    const start = {
      x: event.clientX,
      y: event.clientY,
      w: currentWidth,
      ceiling: frame?.parentElement?.clientWidth ?? null,
      resizing: false,
    };
    dragRef.current = start;

    const dragged = (move: MouseEvent) =>
      clampNoteReferenceWidth(
        start.w + (move.clientX - start.x) - (move.clientY - start.y),
        start.ceiling,
      );

    const onMove = (move: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = move.clientX - drag.x;
      const dy = move.clientY - drag.y;
      if (!drag.resizing) {
        if (Math.hypot(dx, dy) < RESIZE_DISTANCE_PX) return;
        drag.resizing = true;
        document.body.classList.add("is-resizing-note");
        window.getSelection()?.removeAllRanges();
        setDragging(true);
      }
      setWidthPx(dragged(move));
    };
    const onUp = (move: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const drag = dragRef.current;
      dragRef.current = null;
      document.body.classList.remove("is-resizing-note");
      setDragging(false);
      // A click: leave it for the click listener, which opens the note.
      if (!drag?.resizing) return;
      suppressClick.current = true;
      const finalWidth = dragged(move);
      setWidthPx(finalWidth);
      if (Math.abs(finalWidth - drag.w) >= 1) onWidthChange(finalWidth);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <article
      {...rest}
      ref={frameRef}
      className={`${className ?? ""}${onWidthChange && (hovered || dragging) ? " is-resizable" : ""}`}
      style={widthPx != null ? { width: `${widthPx}px` } : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // The card this note sits in is dragged by any press on it. The press
      // belongs to this note, so it must not also pick the card up.
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={onWidthChange ? onMouseDown : undefined}
      onClick={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClick?.(event);
      }}
    >
      {children}
    </article>
  );
}

export function NoteReference({
  id,
  block,
  width,
}: {
  id: number;
  block: boolean;
  width: number | null;
}) {
  const scope = useNoteScope();
  const repeats = scope.chain.includes(id);
  // Hooks stay unconditional; `skip` is what stops a self-reference from asking
  // the backend for the note that is already being rendered.
  const { data: strip, isLoading, error } = noteApi.endpoints.getStrip.useQuery(id, {
    skip: repeats,
  });
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  // A note that references one already on the way down is not followed again:
  // the reader can see it above, and following it would never end.
  if (repeats) {
    return <ReferenceLine block={block}>Note {id} is already open above</ReferenceLine>;
  }

  if (isLoading) return <ReferenceLine block={block}>Note {id}…</ReferenceLine>;

  if (!strip) {
    return isMissing(error) ? (
      <ReferenceLine block={block} tone="missing">
        Note {id} was deleted
      </ReferenceLine>
    ) : (
      <ReferenceLine block={block} tone="error">
        Note {id} could not be loaded
      </ReferenceLine>
    );
  }

  const documentName = strip.pdf_document?.name ?? null;
  const showsDocument = documentName !== null && scope.pdfDocumentId !== strip.pdf_document_id;
  const path = strip.pdf_document?.file_path;
  const hasNote = strip.remark.trim().length > 0;
  // The tooltip is the note flattened to one line: the same label the strip's
  // own card uses, so a reference and the card it points at read alike. A strip
  // with no note has nothing to flatten, and the page's excerpt is not the
  // note — the tooltip names only where the strip is.
  const summary = hasNote ? noteSummary(strip.remark, 140) : "";
  const title = `Page ${strip.page_number}${documentName ? ` of ${documentName}` : ""}${
    summary ? ` — ${summary}` : ""
  }`;
  // Only a host with a list behind it can answer a click. The popup's preview has
  // none, so there a reference stays inert rather than promising a move it cannot
  // make.
  const reveal = scope.revealNote;
  const revealTitle = `${title} — click to show this note`;

  /* A press on something inside the card — a link in the note, a checkbox — is
     that thing's press, not the card's: the reference must not also jump away
     under it. */
  const isOwnControl = (target: EventTarget | null) =>
    target instanceof Element && target.closest("a, button, input, select, textarea") !== null;

  const chipBody = (
    <>
      <StickyNote size={12} aria-hidden />
      <span className="note-ref-chip-page">p.{strip.page_number}</span>
      {showsDocument && <span className="note-ref-chip-doc">{documentName}</span>}
    </>
  );

  if (!block) {
    // In the middle of a sentence: a card would split the sentence it belongs
    // to, so the reference is a small marker naming where the note is.
    return reveal ? (
      <button
        type="button"
        className="note-ref-chip is-revealable"
        title={revealTitle}
        onClick={() => reveal(strip)}
        // The chip sits in a paragraph, and a card's own double-click opens the
        // note editor: one press on a reference is not a press on the note.
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {chipBody}
      </button>
    ) : (
      <span className="note-ref-chip" title={title}>
        {chipBody}
      </span>
    );
  }

  return (
    <NoteScopeProvider noteId={strip.id} pdfDocumentId={strip.pdf_document_id}>
      <NoteRefFrame
        width={width}
        onWidthChange={scope.resizeNote ? (next) => scope.resizeNote?.(id, next) : undefined}
        className={`note-ref${reveal ? " is-revealable" : ""}`}
        data-note-id={strip.id}
        title={reveal ? revealTitle : title}
        // A card is a block of prose, so it cannot be a <button>; the role says
        // what a press does, and the tab stop is what makes it reachable.
        role={reveal ? "button" : undefined}
        tabIndex={reveal ? 0 : undefined}
        onClick={
          reveal
            ? (event) => {
                if (isOwnControl(event.target)) return;
                reveal(strip);
              }
            : undefined
        }
        onKeyDown={
          reveal
            ? (event) => {
                // Only the card's own press: a key pressed inside the note's text
                // belongs to whatever has focus there.
                if (event.target !== event.currentTarget) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                reveal(strip);
              }
            : undefined
        }
        onDoubleClick={reveal ? (event) => event.stopPropagation() : undefined}
        onContextMenu={
          scope.resizeNote
            ? (event) => {
                // This card's menu, not the note it is drawn inside and not the
                // browser's. A nested note further in stops the event itself.
                event.preventDefault();
                event.stopPropagation();
                setMenuAt({ x: event.clientX, y: event.clientY });
              }
            : undefined
        }
      >
        {/* A nested note is always open. Folding belongs to the card in the
            list, not to a reference drawn inside another note. */}
        {path && (
          <span className="note-ref-band">
            <StripThumbnail
              path={path}
              band={strip}
              highlights={strip.highlights}
              annotations={strip.annotations}
            />
          </span>
        )}
        {hasNote && (
          <NoteRefBody
            stripId={strip.id}
            pdfDocumentId={strip.pdf_document_id}
            markdown={strip.remark}
          />
        )}
        {/* The page is a footer here, in the same place and the same shape as an
            ordinary note card's meta line: a reference is read after the note it
            names, so its caption ends the card instead of opening it. */}
        <footer className="note-ref-foot">
          <span className="note-ref-meta">
            Page {strip.page_number}
            {showsDocument ? ` · ${documentName}` : ""}
            {hasNote ? "" : " · no note"}
          </span>
        </footer>
      </NoteRefFrame>
      {menuAt && (
        <ContextMenu
          x={menuAt.x}
          y={menuAt.y}
          label="Nested note"
          onClose={() => setMenuAt(null)}
        >
          <button
            type="button"
            className="strip-menu-item"
            role="menuitem"
            disabled={width == null}
            onClick={() => {
              scope.resizeNote?.(id, null);
              setMenuAt(null);
            }}
          >
            Maximize
          </button>
        </ContextMenu>
      )}
    </NoteScopeProvider>
  );
}

/** A reference with nothing to draw: still loading, gone, or already above. */
function ReferenceLine({
  block,
  tone = "muted",
  children,
}: {
  block: boolean;
  tone?: "muted" | "missing" | "error";
  children: ReactNode;
}) {
  const className = `note-ref-line is-${tone}`;
  // Block-level when the reference stood alone in its paragraph: a paragraph
  // inside a paragraph is not a thing, and the line is the whole paragraph.
  return block ? (
    <p className={className}>{children}</p>
  ) : (
    <span className={`${className} is-inline`}>{children}</span>
  );
}

/** The markdown of the referenced note, one level down the chain. */
function NoteRefBody({
  stripId,
  pdfDocumentId,
  markdown,
}: {
  stripId: number;
  pdfDocumentId: number;
  markdown: string;
}) {
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(
    () => [rehypeKatex, rehypeNoteReferences, rehypeAnnotationReferences],
    [],
  );
  const [updateStrip] = noteApi.endpoints.updateStrip.useMutation();
  // A picture here belongs to the referenced note, not the note that points at
  // it, so the drag writes that note's remark. A nested note inside this one is
  // the same: its width is stored on the reference in this remark.
  const onResize = useCallback(
    (cleanPath: string, width: number) => {
      const remark = replaceImageWidth(markdown, cleanPath, width);
      if (remark === markdown) return;
      void updateStrip({ id: stripId, remark });
    },
    [markdown, stripId, updateStrip],
  );
  const resizeNote = useCallback(
    (childId: number, width: number | null) => {
      const remark =
        width == null
          ? clearNoteReferenceWidth(markdown, childId)
          : replaceNoteReferenceWidth(markdown, childId, width);
      if (remark === markdown) return;
      void updateStrip({ id: stripId, remark });
    },
    [markdown, stripId, updateStrip],
  );

  return (
    <NoteScopeProvider noteId={stripId} pdfDocumentId={pdfDocumentId} resizeNote={resizeNote}>
      <ImageResizeProvider onResize={onResize}>
        <div className="note-ref-markdown">
          <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={noteRefComponents}>
            {markdown}
          </ReactMarkdown>
        </div>
      </ImageResizeProvider>
    </NoteScopeProvider>
  );
}

/** A reference to a strip that is gone answers 404; anything else is a real failure. */
function isMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  return status === 404 || status === "404";
}
