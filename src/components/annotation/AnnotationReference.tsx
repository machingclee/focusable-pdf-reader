/**
 * The annotation a `[annotation:<id>]` reference points at.
 *
 * A reference is how a note says "the thing I am talking about is pinned over
 * there": the reader copies it from a pin's menu and pastes it into a note's
 * markdown, and this component is what that text becomes. It always says the same
 * thing first — **Annotation 12** — and then where it is: the page, and the
 * document when that is not the one being read. Clicking it scrolls the PDF
 * viewer onto the pin, a fifth of the way down the page area, and rings it once;
 * that request travels down as `NoteScope.revealAnnotation`, exactly the way a
 * nested note's click travels as `revealNote`.
 *
 * Two shapes, because the reference has two places to stand:
 *
 *  - inside a sentence it is a pill that rides the line, so naming the annotation
 *    is all it can afford — its words are in the tooltip;
 *  - alone on its line it is a small card: the same label, the page at its right,
 *    and the pin's own writing underneath, drawn as the markdown it is (a formula,
 *    a list, a picture), which is what a reader following a reference from prose
 *    wants to see before the page moves.
 *
 * Three things make it a component rather than a lookup in what is on screen:
 *
 *  - the pin may belong to another document, whose annotations are not loaded
 *    here at all, so the id is resolved on its own through RTK Query
 *    (`GET /annotations/:id`);
 *  - the same id is rendered from cards, from the note popup and from the popped
 *    out window, and RTK Query is what makes those one request and one cache entry,
 *    refreshed by the per-id tag when the pin is retyped;
 *  - a pin that was deleted is a 404, and that is an answer worth drawing — the
 *    line says "was deleted" rather than looking like a broken note.
 *
 * There is no nested-content recursion here, unlike a note reference: an
 * annotation's writing is markdown, and it may itself hold a `[note:<id>]` or another
 * annotation's reference. The card draws the writing with a pipeline that has no
 * reference pass, so those stay the characters the reader typed and a pin that
 * pointed at itself is a sentence rather than a chain.
 */
import { useCallback, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { markdownText } from "../../notesText";
import { MessageSquareText } from "lucide-react";
import { annotationApi } from "../../store/api/annotationApi";
import { annotationReferenceIdOf, annotationReferenceIsBlock } from "../../annotationReference";
import { NoteImage } from "../../markdown/NoteImage";
import { useNoteScope } from "../noteScope";
import type { HastNode } from "../../markdown/toc";

/** How much of the writing the tooltip carries before it is cut. */
const CHIP_CHARS = 90;

/**
 * The pipeline the pin's own writing is drawn with.
 *
 * The writing is markdown — a sentence, a formula, a list, occasionally a picture —
 * so the card renders it rather than flattening it into a line of LaTeX source. It
 * is deliberately the short pipeline: GFM, math and no reference pass, because a
 * reference inside a pin's writing that pointed back at the pin would be a chain
 * this card must not follow. Those stay the characters the reader typed.
 */
const WRITING_REMARK_PLUGINS = [remarkGfm, remarkMath];
const WRITING_REHYPE_PLUGINS = [rehypeKatex];
const WRITING_COMPONENTS = { img: NoteImage } as unknown as Components;

/**
 * The component `react-markdown` renders `<annotation-ref>` with.
 *
 * The id and the block/inline decision travel on the element's properties, which
 * the pass in `annotationReference.ts` set, so the renderer needs no closures of
 * its own and the components map stays a module constant every host can share.
 */
export function AnnotationReferenceElement({ node }: { node?: unknown }) {
  const element = node as HastNode | undefined;
  const id = annotationReferenceIdOf(element);
  if (id === null) return null;
  return <AnnotationReference id={id} block={annotationReferenceIsBlock(element)} />;
}

/** Text flattened to one line and cut, so a chip cannot grow the line it sits in. */
function flatten(text: string, limit: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > limit ? `${oneLine.slice(0, limit - 1)}…` : oneLine;
}

export function AnnotationReference({ id, block }: { id: number; block: boolean }) {
  const scope = useNoteScope();
  const { data: annotation, isLoading, error } = annotationApi.endpoints.getAnnotation.useQuery(id);

  const reveal = scope.revealAnnotation;
  const open = useCallback(
    (event?: ReactMouseEvent) => {
      event?.stopPropagation();
      if (!annotation) return;
      reveal?.(annotation);
    },
    [annotation, reveal],
  );

  // The label is the reference's name, not a description of the pin: it is what the
  // reader wrote and what they will find on the page, so it stays the same whether
  // the writing has loaded, is empty, or is gone.
  const label = `Annotation ${id}`;

  if (isLoading) {
    return (
      <ReferenceLine block={block} title="Looking up this annotation…">
        {label}
        <span className="ann-ref-ellipsis" aria-hidden>
          …
        </span>
      </ReferenceLine>
    );
  }

  if (!annotation) {
    return isMissing(error) ? (
      <ReferenceLine block={block} tone="missing" title={`${label} was deleted`}>
        {label} was deleted
      </ReferenceLine>
    ) : (
      <ReferenceLine block={block} tone="error" title={`${label} could not be loaded`}>
        {label} could not be loaded
      </ReferenceLine>
    );
  }

  const documentName = annotation.pdf_document.name;
  const showsDocument = scope.pdfDocumentId !== annotation.pdf_document_id;
  // The tooltip can only carry a line, so it reads the flattened words — the same
  // flattening a note card's one-line label uses. The card itself draws the writing
  // as what it is, below.
  const plain = markdownText(annotation.text);
  const hasWriting = plain.trim().length > 0;
  const place = `Page ${annotation.page_number}${showsDocument ? ` of ${documentName}` : ""}`;
  const teaser = flatten(plain, CHIP_CHARS);
  const summary = teaser ? `${label} · ${place} — ${teaser}` : `${label} · ${place}`;
  const title = reveal ? `${summary} — click to show it in the PDF viewer` : summary;

  if (!block) {
    // In the middle of a sentence, a card would split the sentence it belongs to:
    // the reference is a pill carrying the name of the thing and where it is. The
    // pin's words would push the sentence off its own line, so they wait in the
    // tooltip — and are spelled out in full when the reference stands alone.
    const body = (
      <>
        <MessageSquareText className="ann-ref-icon" size={12} aria-hidden />
        <span className="ann-ref-label">{label}</span>
        <span className="ann-ref-page">p.{annotation.page_number}</span>
        {showsDocument && <span className="ann-ref-doc">{documentName}</span>}
      </>
    );
    return reveal ? (
      <button
        type="button"
        className="ann-ref-chip is-revealable"
        title={title}
        onClick={open}
        // The card this chip sits in is opened by a double-click: one press on a
        // reference is not a press on the note.
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {body}
      </button>
    ) : (
      <span className="ann-ref-chip" title={title}>
        {body}
      </span>
    );
  }

  return (
    <div
      className={`ann-ref${reveal ? " is-revealable" : ""}`}
      data-annotation-id={annotation.id}
      title={title}
      role={reveal ? "button" : undefined}
      tabIndex={reveal ? 0 : undefined}
      onClick={open}
      onKeyDown={
        reveal
          ? (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              reveal(annotation);
            }
          : undefined
      }
      onDoubleClick={reveal ? (event) => event.stopPropagation() : undefined}
    >
      <span className="ann-ref-head">
        <MessageSquareText className="ann-ref-icon" size={13} aria-hidden />
        <span className="ann-ref-label">{label}</span>
        <span className="ann-ref-meta">{place}</span>
      </span>
      {hasWriting && (
        <div className="ann-ref-body">
          <ReactMarkdown
            remarkPlugins={WRITING_REMARK_PLUGINS}
            rehypePlugins={WRITING_REHYPE_PLUGINS}
            components={WRITING_COMPONENTS}
          >
            {annotation.text}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

/**
 * A reference with nothing to read yet: still loading, gone, or unreadable.
 *
 * Drawn as the same pill an inline reference is, in the tone that fits, so a
 * reference that cannot be answered still looks like the reference it is instead
 * of like a hole in the note.
 */
function ReferenceLine({
  block,
  tone = "muted",
  title,
  children,
}: {
  block: boolean;
  tone?: "muted" | "missing" | "error";
  title?: string;
  children: ReactNode;
}) {
  const className = `ann-ref-line is-${tone}`;
  // Block-level when the reference stood alone in its paragraph: a paragraph
  // inside a paragraph is not a thing, and the line is the whole paragraph.
  return block ? (
    <p className={`${className} is-block`} title={title}>
      {children}
    </p>
  ) : (
    <span className={`${className} is-inline`} title={title}>
      {children}
    </span>
  );
}

/** A reference to an annotation that is gone answers 404; anything else is a failure. */
function isMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  return status === 404 || status === "404";
}
