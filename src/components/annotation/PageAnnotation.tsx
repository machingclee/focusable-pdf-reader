/**
 * One annotation as it stands on a page: the pin, and the writing beside it.
 *
 * The writing is **markdown**, rendered by the note card's own pipeline
 * (`MarkdownNote`), because an annotation is the same kind of thing a note is: it can
 * carry a heading, a list, a table, a picture whose width the reader drags, and a
 * `[note:<id>]` reference to another note. What it does not have is a strip: a note
 * exists because a passage was framed, while an annotation is pinned wherever the
 * reader likes — which is why it is dragged around the page rather than parked.
 *
 * There is no box around the writing. The paper is the background, and the only mark
 * of "this is an annotation" is the pin beside it, so the page's own words are not
 * obscured by a panel.
 *
 * The pin is a **handle**, by default: press it and drag, and the annotation comes
 * with the hand. A press that does not travel is nothing — the editor is on the
 * menu, not on the left button — and a right-click opens that menu, from the pin or
 * from the writing.
 *
 * The writing's right edge is a second handle: dragging it sets the content's width,
 * which is stored on the row (`width`, in PDF points) and is what the markdown wraps
 * to, here and in a note's preview of this page.
 */
import { memo, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import MarkdownNote from "../MarkdownNote";
import { replaceImageWidth } from "../../markdown/noteImages";
import { clearNoteReferenceWidth, replaceNoteReferenceWidth } from "../../noteReference";
import {
  ANNOTATION_FONT_PT,
  ANNOTATION_LINE_PT,
  ANNOTATION_WIDTH_MIN_PT,
  annotationPageBoxes,
  type PageAnnotation,
} from "../../annotation";
import type { AnnotationReveal, NoteReveal } from "../NoteReference";

/** How far past the content's edge the resize handle reaches, in CSS pixels. */
const GRIP_PX = 8;

/**
 * What the writing needs from the viewer.
 *
 * All of it is about the writing, not the pin: the document its references resolve
 * against, the ways a referenced note or annotation is shown, and the two writes an
 * edit inside the content makes (a picture's width, a nested note's width).
 */
export type AnnotationContentTools = {
  /** The open document, so a reference into the same PDF leaves its name out. */
  documentId: number | null;
  /** A `[note:<id>]` inside the writing was clicked. */
  onRevealNote: NoteReveal | null;
  /** An `[annotation:<id>]` inside the writing was clicked. */
  onRevealAnnotation: AnnotationReveal | null;
  /** The writing changed from inside it (a picture or a nested note was resized). */
  onText: (annotation: PageAnnotation, text: string) => void;
  /** The content's edge was dragged. */
  onResize: (annotation: PageAnnotation, width: number) => void;
  /** A right-click on the writing. */
  onMenu: (annotation: PageAnnotation, x: number, y: number) => void;
};

export type PageAnnotationViewProps = {
  /** The row: its id, where its pin's corner is, its width, and what it says. */
  annotation: PageAnnotation;
  /** The page's width in PDF points, which is the room the content has. */
  pageWidth: number;
  /** A reference was just followed to this annotation: ring it once. */
  found?: boolean;
  /** This is the piece being moved. */
  moving?: boolean;
  /**
   * A left press on the pin, in viewport pixels.
   *
   * The caller decides what it becomes: a drag once the pointer travels, or nothing
   * at all when it is released where it landed.
   */
  onPress?: (clientX: number, clientY: number) => void;
  /** The writing's own needs. Absent, the content is drawn but inert. */
  content?: AnnotationContentTools | null;
};

export const PageAnnotationView = memo(function PageAnnotationView({
  annotation,
  pageWidth,
  found = false,
  moving = false,
  onPress,
  content = null,
}: PageAnnotationViewProps) {
  const { size, card } = useMemo(
    () => annotationPageBoxes(annotation, { width: pageWidth }),
    [annotation, pageWidth],
  );
  const contentRef = useRef<HTMLDivElement | null>(null);
  /** The width being dragged, in points, until the release writes it. */
  const [draftWidth, setDraftWidth] = useState<number | null>(null);

  const press = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // The press belongs to the annotation, not to the page under it: the page reads
    // a press as a place to park the band, and this one is the start of a drag.
    event.stopPropagation();
    // No text selection starts from a handle; the drag is the gesture.
    event.preventDefault();
    onPress?.(event.clientX, event.clientY);
  };

  /**
   * Drag the content's right edge.
   *
   * The width follows the pointer immediately — it is local state, so the words
   * re-wrap at the speed of the drag and nothing waits for a round trip. The row is
   * written **once**, on release, and that write is optimistic: the cache takes the
   * new width at the same moment the drag's local width is dropped, so the release
   * has nothing to snap back from.
   *
   * The write is a plain function call on the release, never a side effect inside a
   * state updater: React invokes updaters twice in development, and a write in one
   * would be two history steps for one drag (which is exactly what it was doing).
   */
  const startResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0 || !card) return;
    event.stopPropagation();
    event.preventDefault();
    const box = contentRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    const perPoint = box.width / card.width;
    const startX = event.clientX;
    const startWidth = annotation.width;
    const room = Math.max(ANNOTATION_WIDTH_MIN_PT, pageWidth - annotation.x - card.left);
    /** The width the pointer has chosen, read on release without a re-render. */
    let chosen = startWidth;
    let finished = false;
    const onMove = (move: PointerEvent) => {
      const next = Math.min(
        room,
        Math.max(ANNOTATION_WIDTH_MIN_PT, startWidth + (move.clientX - startX) / perPoint),
      );
      chosen = Math.round(next * 100) / 100;
      setDraftWidth(chosen);
    };
    const onUp = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      setDraftWidth(null);
      if (Math.abs(chosen - annotation.width) >= 0.5) content?.onResize(annotation, chosen);
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  };

  return (
    <div
      // Named on the page as well as in React: the note dialog's preview and the
      // page both draw a piece, and a test can find it by the row it stands for.
      data-annotation-id={annotation.id}
      className={`page-annotation${found ? " is-found" : ""}${moving ? " is-moving" : ""}`}
      style={{
        ["--ann-x" as string]: String(annotation.x),
        ["--ann-y" as string]: String(annotation.y),
        ["--ann-pin" as string]: String(size),
        ["--ann-card-left" as string]: String(card?.left ?? 0),
        ["--ann-card-top" as string]: String(card?.top ?? 0),
        ["--ann-card-w" as string]: String(draftWidth ?? card?.width ?? 0),
        ["--ann-font" as string]: String(ANNOTATION_FONT_PT),
        ["--ann-line" as string]: String(ANNOTATION_LINE_PT),
        ["--ann-grip" as string]: String(GRIP_PX),
      }}
    >
      <span className="page-annotation-pin" aria-hidden onPointerDown={press} />
      {card && (
        <div
          ref={contentRef}
          className="page-annotation-content"
          // The writing is a live surface: a reference or a picture inside it is
          // the reader's to press. While the piece is being moved it is a handle too.
          onPointerDown={moving ? press : undefined}
          onContextMenu={(event) => {
            if (!content) return;
            // A right-click on the writing is a right-click on the annotation.
            event.preventDefault();
            event.stopPropagation();
            content.onMenu(annotation, event.clientX, event.clientY);
          }}
        >
          {content ? (
            <MarkdownNote
              markdown={annotation.text}
              pdfDocumentId={content.documentId}
              onRevealNote={content.onRevealNote}
              onRevealAnnotation={content.onRevealAnnotation}
              onImageWidthChange={(cleanPath, width) =>
                content.onText(annotation, replaceImageWidth(annotation.text, cleanPath, width))
              }
              onNoteWidthChange={(noteId, width) =>
                content.onText(
                  annotation,
                  width == null
                    ? clearNoteReferenceWidth(annotation.text, noteId)
                    : replaceNoteReferenceWidth(annotation.text, noteId, width),
                )
              }
            />
          ) : (
            annotation.text
          )}
          {content && (
            // Inside the content, because that box is the one with a height: the
            // piece's own is a zero-sized corner.
            <span
              className="page-annotation-grip"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize this annotation"
              onPointerDown={startResize}
            />
          )}
        </div>
      )}
    </div>
  );
});
