/**
 * A window opened on one passage: open its document, then put the reader there.
 *
 * A `[note:<id>]` or `[annotation:<id>]` reference opens a viewer of its own
 * rather than moving the window the reader is in. Such a window arrives with a
 * request in its query string (`viewerRequest.ts`), and this is what turns that
 * request into a page on screen — once, after the first render, because from that
 * point on the window is an ordinary viewer.
 *
 * The order matters and is why this is one hook: the passage cannot be placed
 * before its document is loaded (its page would still be the previous document's,
 * or missing), and it must not be placed twice (a re-render after the placement
 * would drag the reader back to it every time anything changed).
 *
 * A note is placed by the viewer's own "stand on this strip" — the state a note
 * card's click and a badge's double-click produce: the band over the note's band
 * of the page, focus mode on, the page scrolled to it, and the strip remembered
 * for the notes column so opening it lands on that card.
 *
 * An annotation is placed as a place, not as a band: nothing is parked and focus
 * mode stays off, because the reader asked to see where the pin stands, not to
 * read one band of the page. The page's own height is what turns the stored point
 * into the fraction the scroll maths wants; without it the pin cannot be placed
 * yet and the effect waits for the next render.
 */
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { AnnotationWithDocument, NoteWithDocument } from "../../types/dto";
import type { LoadedPdf } from "../../pdf";
import type { ViewerRequest } from "../../viewerRequest";
import { annotationPointFrac } from "../../annotation";

export type ReferenceViewerOptions = {
  /** What this window was opened for, or null for an ordinary window. */
  request: ViewerRequest | null;
  /** Open the document the window was opened on. Resolves whether it opened. */
  openDocument: (filePath: string) => Promise<boolean>;
  /** The note the window was opened on, once the backend has answered. */
  note: NoteWithDocument | undefined;
  /** The annotation it was opened on, once the backend has answered. */
  annotation: AnnotationWithDocument | undefined;
  /** The open document, whose pages the pin's fraction is measured against. */
  pdf: LoadedPdf | null;
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** Stand the band on a saved strip. */
  parkStrip: (strip: NoteWithDocument) => void;
  /** Remember a strip for the notes column. */
  revealStrip: (id: number) => void;
  /** Put a page's point on the reading line. */
  alignPagePoint: (node: HTMLElement, fracY: number, x: number) => void;
  /** Name the page the pin stands on. */
  showPage: (page: number) => void;
  /** Ring the pin that was just found. */
  foundAnnotation: (id: number) => void;
};

export function useReferenceViewer({
  request,
  openDocument,
  note,
  annotation,
  pdf,
  scrollerRef,
  parkStrip,
  revealStrip,
  alignPagePoint,
  showPage,
  foundAnnotation,
}: ReferenceViewerOptions): void {
  /** The document is open, so a passage request can be placed on it. */
  const [documentReady, setDocumentReady] = useState(false);
  const openStarted = useRef(false);
  const notePlaced = useRef(false);
  const annotationPlaced = useRef(false);

  useEffect(() => {
    if (!request || openStarted.current) return;
    openStarted.current = true;
    void (async () => {
      if (await openDocument(request.filePath)) setDocumentReady(true);
    })();
  }, [openDocument, request]);

  useEffect(() => {
    if (!documentReady || !note || notePlaced.current) return;
    notePlaced.current = true;
    revealStrip(note.id);
    parkStrip(note);
  }, [documentReady, note, parkStrip, revealStrip]);

  useEffect(() => {
    if (!documentReady || !annotation || annotationPlaced.current) return;
    if (!pdf) return;
    const page = annotation.page_number;
    const height = pdf.pages.find((candidate) => candidate.index === page)?.height ?? 0;
    if (height <= 0) return;
    const node = scrollerRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`);
    if (!node) return;
    annotationPlaced.current = true;
    alignPagePoint(node, annotationPointFrac(annotation, height), 0);
    showPage(page);
    foundAnnotation(annotation.id);
  }, [alignPagePoint, annotation, documentReady, foundAnnotation, pdf, scrollerRef, showPage]);
}
