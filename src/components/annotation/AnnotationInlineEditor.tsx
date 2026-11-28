/**
 * A pin's writing, changed **where it stands**.
 *
 * Double-clicking an annotation does not open a box somewhere near it: the writing
 * itself turns into an editor, at the annotation's own corner and width, on a sheet of
 * the page's own white. The sheet is solid — the pane inside paints nothing, so what
 * reads under the words is the box's paper and never the page's own type, which would
 * otherwise look like part of the line being typed. Around the sheet the page is
 * untouched, so the paragraph the writing sits in stays where the reader left it.
 * Saving turns the same words back into the rendered markdown the pin drew before.
 * That is why this editor is a part of the page (`PageAnnotation`) and not an overlay:
 * everything about where it stands is the page's layout, and a floating box would have
 * to be re-measured on every scroll and zoom to keep the illusion.
 *
 * It is opened by the page's own gesture — a double-press that lands on the pin or on
 * its writing beats parking the reading band (`ViewerWindow`'s `editAnnotationAtPress`)
 * — and by nothing else. The pin's menu offers **Edit with preview** instead, which
 * is the same writing in the markdown popup with a rendered preview
 * (`AnnotationMarkdownDialog`): a small correction is made here, where the words
 * already are, and a longer piece is written there, where the markdown can be seen.
 * The floating `AnnotationEditor` is still what writes a *new* pin, where there is no
 * writing to change in place yet.
 *
 * What commits the text:
 *
 * - `⌘↵` / `Ctrl+↵`, `⌘S` / `Ctrl+S` and a press anywhere off the annotation;
 * - `Esc` drops the edit. The viewer's own key handler (`useViewerShortcuts`) answers
 *   it first, because a draft is the innermost layer there is; the handler below is the
 *   same answer, and dropping a draft twice is the same as dropping it once.
 *
 * A press elsewhere **keeps** what was typed rather than dropping it, which is the
 * opposite of the rule the new-pin box follows. The difference is what is at stake:
 * that box holds a note nobody has read yet, and a click off the paper means the pen
 * went down; this one is holding words that are already on the page, and silently
 * throwing them away is the worse of the two mistakes.
 *
 * The box's geometry is measured, not assumed. The page's sizes are CSS (`--ann-font`
 * × `--zoom`), while Monaco takes a font size in pixels and a height in pixels, so the
 * shell reads its own rendered type once and again whenever the page is zoomed
 * (`ResizeObserver`), and hands the pane the room the page has below the pin. That
 * room is the pane's constant height; the frame around it is clipped to the height the
 * text actually needs, so adding a line is a clip change and never a Monaco relayout.
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ANNOTATION_FONT_PT, annotationFontPt, type PageAnnotation } from "../../annotation";
import { annotationEditorHeight, annotationEditorRoom } from "../../annotationEditorBox";
import { useMarkdownShortcuts } from "../../markdown/useMarkdownShortcuts";

/**
 * The editor itself, in its own chunk: a pin is opened for editing only when the
 * reader asks, and Monaco has no business in the viewer's first download.
 */
const AnnotationCodeEditor = lazy(() =>
  import("./AnnotationCodeEditor").then((module) => ({ default: module.AnnotationCodeEditor })),
);

/**
 * The smallest type the pane is given, in CSS px.
 *
 * At the viewer's bottom zoom a pin's writing is five pixels tall, and Monaco has no
 * useful type down there. A pin read that far out is a speck on the sheet anyway, so
 * the editor keeps a legible floor rather than matching the page to the pixel.
 */
const MIN_PANE_FONT_PX = 9;

export type AnnotationInlineEditorProps = {
  /** The row being changed: its words, its corner and its width, in PDF points. */
  annotation: PageAnnotation;
  /** The page's height in PDF points: the room the box may take below the pin. */
  pageHeight: number;
  /** A write is in flight: the box stays put, and a second commit is refused. */
  saving: boolean;
  /** Why the last write did not land, if it did not. */
  error: string | null;
  /** Commit the writing. The shell has already trimmed it and dropped a no-op. */
  onSave: (text: string) => void;
  /** Nothing was written: leave the row as it was. */
  onCancel: () => void;
};

export function AnnotationInlineEditor({
  annotation,
  pageHeight,
  saving,
  error,
  onSave,
  onCancel,
}: AnnotationInlineEditorProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** The clipped frame inside the box: this is the height the text needs. */
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState(annotation.text);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /**
   * The measurements taken from the page: the type it draws the writing in, the room
   * below the pin, and the height the text last reported. Kept in a ref as well,
   * because the height apply runs from a Monaco callback that must read the current
   * numbers without being rebuilt.
   *
   * Until the box has been measured its numbers are the unzoomed ones, which is what
   * the first frame would be if anyone saw it: the measure effect below runs before
   * paint.
   */
  /**
   * The size this pin is written at on paper, which is what the page multiplied by
   * the zoom: the editor has to give back the same type, and the room below the pin
   * is measured in the page's own points.
   */
  const pinFont = annotationFontPt(annotation.font_size);
  const [fontSize, setFontSize] = useState(pinFont);
  const [room, setRoom] = useState(() => annotationEditorRoom(pageHeight, annotation.y, pinFont, pinFont));
  const measured = useRef({ fontSize: ANNOTATION_FONT_PT, room, content: 0 });
  const savingRef = useRef(saving);
  savingRef.current = saving;

  /**
   * The height the frame needs for `contentHeight`, held between a couple of lines
   * and the room below the pin. Written straight onto the element, never through
   * state: a state write per line re-rendered the box and the pane with it, which is
   * the flicker the card's editor was cured of the same way.
   */
  const applyHeight = useCallback((contentHeight: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    measured.current.content = contentHeight;
    const { fontSize: type, room: space } = measured.current;
    const next = annotationEditorHeight(contentHeight, type, space);
    // Sub-pixel reports would still cost a layout; only a real change is worth one.
    if (Math.abs(frame.getBoundingClientRect().height - next) < 0.5) return;
    frame.style.height = `${next}px`;
  }, []);

  // The box's own type is the page's: `--ann-font × --zoom` is a length the reader's
  // zoom changes, so it is read from the rendered element and re-read when the page
  // resizes under it.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const style = window.getComputedStyle(box);
      const type = Number.parseFloat(style.fontSize);
      const nextFont = Number.isFinite(type) && type > 0 ? type : ANNOTATION_FONT_PT;
      // Below the pin, on its own page: the annotation's writing may spill over the
      // bottom of the sheet, but an editor that ran off it would be writing on the
      // desk. The floor is a couple of lines, so the last line of a page still edits.
      const space = annotationEditorRoom(pageHeight, annotation.y, nextFont, pinFont);
      measured.current = { ...measured.current, fontSize: nextFont, room: space };
      setFontSize(Math.max(MIN_PANE_FONT_PX, Math.round(nextFont)));
      setRoom(space);
      // A zoom changed the room under the box: the frame is clipped to the new one now
      // rather than waiting for Monaco to report its text again.
      applyHeight(measured.current.content);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [annotation.y, applyHeight, pageHeight, pinFont]);

  /**
   * The box opens at the height the writing was read at.
   *
   * The rendered writing is not unmounted while it is being changed — it is hidden,
   * so it keeps its layout — and its height is what the box starts at. Without this
   * the first frame would be a floor-height box, and the reader's paragraph would
   * jump under the double-click that opened it.
   */
  useLayoutEffect(() => {
    const replaced = boxRef.current?.closest(".page-annotation")?.querySelector(".page-annotation-content");
    if (!replaced) return;
    applyHeight(replaced.getBoundingClientRect().height);
  }, [applyHeight]);

  /** Write the draft, unless there is nothing to write or nothing changed. */
  const commit = useCallback(() => {
    if (savingRef.current) return;
    const text = draftRef.current.trim();
    // A pin with no words is a mark with nothing to read: an empty draft is refused
    // rather than stored, and the editor stays open on it.
    if (!text) return;
    if (text === annotation.text) {
      onCancel();
      return;
    }
    onSave(text);
  }, [annotation.text, onCancel, onSave]);

  // A press anywhere off the annotation leaves the field, and the words are kept (see
  // the file comment for why this is not a cancel). A press on the pin or on the
  // hidden writing is still the annotation's, so a double-press that lands there does
  // not close and re-open the box under the reader's hand.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const piece = boxRef.current?.closest(".page-annotation");
      const target = event.target;
      if (piece && target instanceof Node && piece.contains(target)) return;
      commit();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [commit]);

  // Bound at the window: Monaco handles several of these keys itself and stops them
  // from bubbling, so a handler on the box would never see them.
  useMarkdownShortcuts({ onSave: commit, onSubmit: commit, onEscape: onCancel });

  return (
    <div
      ref={boxRef}
      className="page-annotation-editor"
      // The pane is given the room, not the height: it never re-lays-out as lines are
      // added, and the frame above it is what follows the text.
      style={{ ["--ann-editor-room" as string]: `${room}px` }}
      role="group"
      aria-label="Edit annotation"
      // The page under the box has its own press and menu handlers; both are about the
      // paper, and this box is on it but not of it.
      onContextMenu={(event) => event.stopPropagation()}
    >
      <div className="ann-inline-frame" ref={frameRef}>
        <Suspense
          fallback={
            // While Monaco's chunk is on its way the words are still editable: a plain
            // field in the same type, which grows with what is typed into
            // it. It is the same fallback the notes column uses for its card editor.
            <textarea
              className="ann-inline-field"
              value={draft}
              spellCheck
              aria-label="Annotation text"
              autoFocus
              onChange={(event) => {
                setDraft(event.target.value);
                applyHeight(event.currentTarget.scrollHeight);
              }}
            />
          }
        >
          <AnnotationCodeEditor
            value={draft}
            fontSize={fontSize}
            onChange={setDraft}
            onContentHeightChange={applyHeight}
          />
        </Suspense>
      </div>
      {error && (
        <p className="ann-inline-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
