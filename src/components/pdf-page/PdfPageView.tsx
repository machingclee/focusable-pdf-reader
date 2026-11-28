/**
 * One page of the open PDF, as the reader sees it.
 *
 * The page draws itself and everything that belongs to it: the canvas, the text
 * layer the links and the selection live on, the document's saved marks, the
 * annotations, the search hits, and whichever tool is armed on it (the highlight
 * pen, the annotation catch). It is a component of its own because the page is
 * the one place all of those spaces meet, and because a page must not re-render
 * the reader's zoom: its sizes go to CSS as custom properties, so a zoom tick
 * rewrites one variable on the column instead of re-rendering every page.
 *
 * The page takes no pointer of its own beyond the tools: a press passes through
 * to the words, so text stays selectable and a drag still scrolls. What it does
 * answer is a right-click, matched by hit test against the marks and pins it is
 * drawing (`markAtPoint`, `annotationAtPoint`) rather than by DOM targets, so the
 * slack of a hit is a length on screen and is as forgiving at 400% as at 100%.
 */
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  renderPageAnnotationLayer,
  renderPageToCanvas,
  renderPageTextLayer,
  type LoadedPage,
  type PdfLinkActions,
} from "../../pdf";
import type { SearchBox } from "../../search";
import { bindPageHighlightDraft } from "../../pageHighlightDraft";
import {
  MARK_HIT_SLACK_PX,
  markAtPoint,
  type StripHighlight,
} from "../../stripHighlight";
import {
  ANNOTATION_HIT_SLACK_PX,
  annotationAtPoint,
  type PageAnnotation,
} from "../../annotation";
import { PdfPagePen } from "../highlight/PdfPagePen";
import { PdfPageAnnotationCatch } from "../annotation/PdfPageAnnotationCatch";
import { PageAnnotationView, type AnnotationContentTools, type AnnotationEditTools } from "../annotation/PageAnnotation";

/** Stands in for a page that owns no pins, so the common case allocates nothing. */
export const NO_ANNOTATIONS: readonly PageAnnotation[] = [];

export const PdfPageView = memo(function PdfPageView({
  page,
  renderZoom,
  hits,
  activeHit,
  marks = [],
  annotations = NO_ANNOTATIONS,
  highlighting = false,
  onStroke,
  onMarkContextMenu,
  annotating = false,
  onAnnotationPoint,
  onAnnotationMenu,
  foundAnnotationId = null,
  movingAnnotationId = null,
  onAnnotationPress,
  annotationContent = null,
  annotationEdit = null,
  linkActionsRef,
}: {
  page: LoadedPage;
  renderZoom: number;
  hits: Array<{ index: number; boxes: SearchBox[] }>;
  activeHit: number;
  /** This page's marks, in PDF points. They belong to the document. */
  marks?: readonly StripHighlight[];
  /** This page's annotations, in PDF points. The document owns them too. */
  annotations?: readonly PageAnnotation[];
  /** The toolbar pen is down, so a drag on this page lays a stroke. */
  highlighting?: boolean;
  onStroke?: (mark: StripHighlight) => void;
  /** Open this stroke's menu at the pointer. The pen is what offers it. */
  onMarkContextMenu?: (mark: StripHighlight, x: number, y: number) => void;
  /** The annotation tool is armed, so a click on this page places a pin. */
  annotating?: boolean;
  onAnnotationPoint?: (point: { x: number; y: number }, clientX: number, clientY: number) => void;
  /** A pin was right-clicked: open its menu at the pointer. */
  onAnnotationMenu?: (annotation: PageAnnotation, x: number, y: number) => void;
  /** The pin a reference just scrolled to, pulsed once so it can be found. */
  foundAnnotationId?: number | null;
  /** The pin being moved: it is drawn where the drag left it until it is placed. */
  movingAnnotationId?: number | null;
  /**
   * A left press on a pin: the start of a drag, or of nothing at all.
   *
   * The page does not decide which — it reports where the press landed, and `App`
   * waits for the pointer to travel before calling the piece a drag.
   */
  onAnnotationPress?: (annotation: PageAnnotation, clientX: number, clientY: number) => void;
  /**
   * What the writing inside a pin needs: its document, the two reveal handlers, and
   * the two writes an edit made inside the content makes.
   */
  annotationContent?: AnnotationContentTools | null;
  /**
   * The pin whose writing is being changed in place, and the answers an edit gives.
   *
   * The edit is a page's own business to *draw* — it stands at the annotation's
   * corner, at the page's zoom — while which pin it is and where the text goes are
   * the viewer's, so only the fact is threaded down here.
   */
  annotationEdit?: AnnotationEditTools | null;
  /** Clicks on this page's link annotations. Stable for the life of the viewer. */
  linkActionsRef: { readonly current: PdfLinkActions };
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const annotationLayerRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setShouldRender(true);
      },
      { rootMargin: "1400px 800px" },
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

  useEffect(() => {
    if (!shouldRender) return;
    const container = annotationLayerRef.current;
    if (!container) return;
    const task = renderPageAnnotationLayer(page.pdfPage, container, linkActionsRef);
    return () => task.cancel();
  }, [page, shouldRender, linkActionsRef]);

  const highlightMarks = useMemo(() => {
    return marks.flatMap((mark, index) => {
      const width = Math.abs(mark.x1 - mark.x0);
      if (width < 0.5) return [];
      return [{
        key: `${page.index}-${index}`,
        x: Math.min(mark.x0, mark.x1),
        y: mark.y,
        w: width,
        h: mark.size,
      }];
    });
  }, [marks, page.index]);

  /**
   * The saved mark under the pointer, as an index into `marks`.
   *
   * The marks themselves take no pointer — the words under them stay selectable
   * — so a right-click is matched against them by hit test instead: the pointer's
   * place is put back into PDF points through the page's current box, the space
   * the marks live in. The slack is a length on screen, so a stroke's edge is as
   * forgiving at 400% as at 100%.
   */
  const markUnderPointer = (clientX: number, clientY: number): number | null => {
    const host = wrapRef.current;
    if (!host || marks.length === 0) return null;
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const scale = rect.width / (page.width > 0 ? page.width : 1);
    return markAtPoint(
      marks,
      { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale },
      MARK_HIT_SLACK_PX / scale,
    );
  };

  /**
   * The pin under the pointer, as an index into `annotations`.
   *
   * Measured the same way a mark is: the pointer's place is put back into PDF
   * points through the page's current box, and the slack is a length on screen so a
   * pin's edge answers the same at every zoom.
   */
  const annotationUnderPointer = (clientX: number, clientY: number): number | null => {
    const host = wrapRef.current;
    if (!host || annotations.length === 0) return null;
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const scale = rect.width / (page.width > 0 ? page.width : 1);
    return annotationAtPoint(
      annotations,
      { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale },
      { width: page.width },
      ANNOTATION_HIT_SLACK_PX / scale,
    );
  };

  const annotationAt = (clientX: number, clientY: number): PageAnnotation | null => {
    const index = annotationUnderPointer(clientX, clientY);
    if (index == null) return null;
    return annotations[index] ?? null;
  };

  /**
   * Right-clicking a stroke is how one is removed.
   *
   * The stroke's whole length is the target, so there is no control to aim at on
   * the page. It is the pen's menu: with the pen put down a right-click keeps its
   * reading meaning (the strip's own menu in focus mode), and no delete path is
   * invented on the page while reading.
   *
   * A pin is the exception, and it comes first: it is a small thing with its own
   * identity, so a right-click that lands on one is about that annotation whatever
   * tool happens to be armed.
   */
  const onPageContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    // A move is placed by the next right-click, wherever it lands — so the page
    // lets the press through to the stage, which is what answers it.
    if (movingAnnotationId != null) return;
    const annotation = onAnnotationMenu ? annotationAt(event.clientX, event.clientY) : null;
    if (annotation && onAnnotationMenu) {
      event.preventDefault();
      event.stopPropagation();
      onAnnotationMenu(annotation, event.clientX, event.clientY);
      return;
    }
    if (!highlighting || !onMarkContextMenu) return;
    const index = markUnderPointer(event.clientX, event.clientY);
    if (index == null) return;
    const mark = marks[index];
    if (!mark) return;
    // The menu is what answered this press; the stage's own right-click must not
    // open the strip's menu behind it as well.
    event.preventDefault();
    event.stopPropagation();
    onMarkContextMenu(mark, event.clientX, event.clientY);
  };

  return (
    <div
      ref={wrapRef}
      className="page-shell"
      data-page={page.index}
      onContextMenu={onPageContextMenu}
      style={{
        /* Sizes live in CSS as `calc(var(--page-w) * var(--zoom))`, so a zoom
           tick only rewrites one custom property on the column instead of
           re-rendering every page in the document. */
        ["--page-w" as string]: String(page.width),
        ["--page-h" as string]: String(page.height),
      }}
    >
      <canvas ref={canvasRef} />
      {/* One multiply group for every mark on this page, saved or still being
          drawn. The shapes are one yellow, so a crossing stays that yellow, and
          the group multiplies it into the paper. The same list is what the
          note preview paints. */}
      <div className="page-highlights" aria-hidden>
        {highlightMarks.map((mark) => (
          <div
            key={mark.key}
            className="page-highlight"
            style={{
              ["--hit-x" as string]: String(mark.x),
              ["--hit-y" as string]: String(mark.y),
              ["--hit-w" as string]: String(mark.w),
              ["--hit-h" as string]: String(mark.h),
            }}
          />
        ))}
        <div
          className="page-highlight"
          ref={(node) => bindPageHighlightDraft(page.index, node)}
          hidden
        />
      </div>
      <div ref={textLayerRef} className="textLayer" />
      {/* Link annotations sit above the text so a click hits the link, and
          after the text layer so a drag that is selecting words can pass
          through them (see `.textLayer.selecting ~ .annotationLayer`). */}
      <div ref={annotationLayerRef} className="annotationLayer" />
      {hits.length > 0 && (
        <div className="search-layer" aria-hidden>
          {hits.map((hit) =>
            hit.boxes.map((box, boxIndex) => (
              <div
                key={`${hit.index}-${boxIndex}`}
                data-hit={hit.index}
                className={hit.index === activeHit ? "search-hit current" : "search-hit"}
                style={{
                  ["--hit-x" as string]: String(box.left),
                  ["--hit-y" as string]: String(box.top),
                  ["--hit-w" as string]: String(box.width),
                  ["--hit-h" as string]: String(box.height),
                }}
              />
            )),
          )}
        </div>
      )}
      {/* The annotations, drawn over the marks so they are not multiplied into the
          paper. Each piece draws itself (`PageAnnotation`): the pin and the card of
          text beside it, laid out by the same function a note's preview paints.
          They take no left click — a press passes through to the words underneath —
          and the press they answer is a right-click, which the page reports from its
          own hit test. The exception is the piece being moved, which is the thing in
          the reader's hand for as long as the move lasts. */}
      {annotations.length > 0 && (
        <div className="page-annotations">
          {annotations.map((annotation) => (
            <PageAnnotationView
              key={annotation.id}
              annotation={annotation}
              pageWidth={page.width}
              pageHeight={page.height}
              found={annotation.id === foundAnnotationId}
              moving={annotation.id === movingAnnotationId}
              editing={annotationEdit?.editingId === annotation.id ? annotationEdit : null}
              onPress={
                onAnnotationPress
                  ? (clientX, clientY) => onAnnotationPress(annotation, clientX, clientY)
                  : undefined
              }
              content={annotationContent}
            />
          ))}
        </div>
      )}
      {highlighting && onStroke && (
        <PdfPagePen pageWidth={page.width} pageHeight={page.height} onStroke={onStroke} />
      )}
      {annotating && onAnnotationPoint && (
        <PdfPageAnnotationCatch
          pageWidth={page.width}
          pageHeight={page.height}
          onPoint={(point, clientX, clientY) => onAnnotationPoint(point, clientX, clientY)}
        />
      )}
      <span className="page-index">{page.index}</span>
    </div>
  );
});
