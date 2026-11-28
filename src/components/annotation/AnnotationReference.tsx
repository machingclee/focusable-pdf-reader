/**
 * The annotation a `[annotation:<id>]` reference points at.
 *
 * A reference is how a note says "the thing I am talking about is pinned over
 * there": the reader copies it from a pin's menu and pastes it into a note's
 * markdown, and this component is what that text becomes — the annotation's own
 * words, the page it stands on, and its document when that is not the one being
 * read. Clicking it opens a PDF window showing the pin; that request travels down
 * as `NoteScope.revealAnnotation`, exactly the way a nested note's click travels
 * as `revealNote`.
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
 * annotation's reference; the chip only ever shows its words, so there is no chain to
 * follow from here.
 */
import { useCallback, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { markdownText } from "../../notesText";
import { MessageSquareText } from "lucide-react";
import { annotationApi } from "../../store/api/annotationApi";
import { annotationReferenceIdOf, annotationReferenceIsBlock } from "../../annotationReference";
import { useNoteScope } from "../noteScope";
import type { HastNode } from "../../markdown/toc";

/** How much of the text an inline chip shows before it is cut. */
const CHIP_CHARS = 60;

/** How much of the text a block card shows. A pin is not an essay, and a note is. */
const CARD_CHARS = 600;

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

  if (isLoading) return <ReferenceLine block={block}>Annotation {id}…</ReferenceLine>;

  if (!annotation) {
    return isMissing(error) ? (
      <ReferenceLine block={block} tone="missing">
        Annotation {id} was deleted
      </ReferenceLine>
    ) : (
      <ReferenceLine block={block} tone="error">
        Annotation {id} could not be loaded
      </ReferenceLine>
    );
  }

  const documentName = annotation.pdf_document.name;
  const showsDocument = scope.pdfDocumentId !== annotation.pdf_document_id;
  // The writing is markdown; a chip is a line, so it reads the flattened words —
  // the same flattening a note card's one-line label uses.
  const text = markdownText(annotation.text);
  const title = `Page ${annotation.page_number}${showsDocument ? ` of ${documentName}` : ""} — ${flatten(
    text,
    CARD_CHARS,
  )}`;
  const revealTitle = reveal ? `${title} — click to show this annotation in a PDF window` : title;

  if (!block) {
    // In the middle of a sentence, a card would split the sentence it belongs to:
    // the reference is a small marker carrying the first words of the pin.
    const body = (
      <>
        <MessageSquareText size={12} aria-hidden />
        <span className="ann-ref-chip-text">{flatten(text, CHIP_CHARS)}</span>
        <span className="ann-ref-chip-page">p.{annotation.page_number}</span>
        {showsDocument && <span className="ann-ref-chip-doc">{documentName}</span>}
      </>
    );
    return reveal ? (
      <button
        type="button"
        className="ann-ref-chip is-revealable"
        title={revealTitle}
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
    <span
      className={`ann-ref${reveal ? " is-revealable" : ""}`}
      data-annotation-id={annotation.id}
      title={revealTitle}
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
        <MessageSquareText size={12} aria-hidden />
        <span className="ann-ref-meta">
          Page {annotation.page_number}
          {showsDocument ? ` · ${documentName}` : ""}
        </span>
      </span>
      <span className="ann-ref-body">{flatten(text, CARD_CHARS)}</span>
    </span>
  );
}

/** A reference with nothing to draw: still loading, gone, or unreadable. */
function ReferenceLine({
  block,
  tone = "muted",
  children,
}: {
  block: boolean;
  tone?: "muted" | "missing" | "error";
  children: ReactNode;
}) {
  const className = `ann-ref-line is-${tone}`;
  // Block-level when the reference stood alone in its paragraph: a paragraph
  // inside a paragraph is not a thing, and the line is the whole paragraph.
  return block ? (
    <p className={className}>{children}</p>
  ) : (
    <span className={`${className} is-inline`}>{children}</span>
  );
}

/** A reference to an annotation that is gone answers 404; anything else is a failure. */
function isMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  return status === 404 || status === "404";
}
