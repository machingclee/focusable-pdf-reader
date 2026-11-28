/**
 * The pages themselves, inside the stage's scroller: the document laid out single
 * or two-up, or the invitation when nothing is open.
 *
 * The column is a component of its own because it is the one place the page's
 * tools meet: the search hits painted on a page, the document's marks, its pins,
 * and whichever tool is armed. What it draws *of* them is defined elsewhere — the
 * marks and pins belong to the document, the hits to the find bar — and this
 * column decides which page gets which of them.
 *
 * What the reader has chosen — the zoom, the layout, the hit they are on — the
 * column reads from the store itself. That is why no zoom, layout or find state is
 * threaded down through the viewer: a zoom tick rewrites one custom property on
 * the column and re-renders the column, not the window that holds the stage.
 *
 * The zoom is handed to CSS as one custom property on the column (`--zoom`), so a
 * zoom tick rewrites a variable instead of re-rendering every page in the
 * document.
 */
import { useEffect, useMemo, useState, type RefObject } from "react";
import { PdfPageView } from "./PdfPageView";
import { EmptyDocument } from "../stage/EmptyDocument";
import type { LoadedPdf, PdfLinkActions } from "../../pdf";
import type { RecentDoc } from "../../prefs";
import type { SearchBox } from "../../search";
import type { DocumentHighlight, StripHighlight } from "../../stripHighlight";
import type { PageAnnotation } from "../../annotation";
import type { AnnotationContentTools } from "../annotation/PageAnnotation";
import { pairPages, SPREAD_GAP_PX } from "../../pageLayout";
import { useAppSelector } from "../../store/hooks";
import { selectPageLayout, selectZoom } from "../../store/slices/viewerSlice";
import { selectActiveHit, selectSearchHits } from "../../store/slices/searchSlice";

/**
 * How long the zoom has to sit still before every page canvas is redrawn at it.
 *
 * A pinch would otherwise start a render per tick and throw most of them away; the
 * pages' *boxes* follow the zoom immediately (CSS), only the bitmaps wait.
 */
const RENDER_ZOOM_DEBOUNCE_MS = 140;

/** A value that follows another after it has been still for `delay` ms. */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return settled;
}

/** The document's saved strokes, and the pen that can add or remove one. */
export type HighlightToolsProps = {
  marks: DocumentHighlight[];
  penDown: boolean;
  onStroke: (page: number, mark: StripHighlight) => void;
  /** A stroke was right-clicked: open its menu at the pointer. */
  onMenu: (page: number, mark: StripHighlight, x: number, y: number) => void;
};

/** The document's pins, and the tool that can place, move or edit one. */
export type AnnotationToolsProps = {
  /** The pins one page draws, including the one being dragged. */
  ofPage: (page: number) => readonly PageAnnotation[];
  toolArmed: boolean;
  onPlace: (page: number, point: { x: number; y: number }, clientX: number, clientY: number) => void;
  /** A pin was right-clicked, and where the press fell. */
  onMenu: (annotation: PageAnnotation, x: number, y: number) => void;
  foundId: number | null;
  movingId: number | null;
  onPress: (annotation: PageAnnotation, clientX: number, clientY: number) => void;
  /** The writing's own needs: document, references, and the two writes it makes. */
  content: AnnotationContentTools | null;
};

/** What the column shows when there is no document. */
export type EmptyColumnProps = {
  busy: boolean;
  onOpenPicker: () => void;
  onOpenRecent: (doc: RecentDoc) => void;
};

export type PagesColumnProps = {
  pdf: LoadedPdf | null;
  scrollerRef: RefObject<HTMLDivElement | null>;
  highlights: HighlightToolsProps;
  annotations: AnnotationToolsProps;
  empty: EmptyColumnProps;
  /** Clicks on a page's link annotations; stable for the life of the viewer. */
  linkActionsRef: { readonly current: PdfLinkActions };
};

const NO_HITS: Array<{ index: number; boxes: SearchBox[] }> = [];

export function PagesColumn({
  pdf,
  scrollerRef,
  highlights,
  annotations,
  empty,
  linkActionsRef,
}: PagesColumnProps) {
  const zoom = useAppSelector(selectZoom);
  const layout = useAppSelector(selectPageLayout);
  const renderZoom = useDebouncedValue(zoom, RENDER_ZOOM_DEBOUNCE_MS);
  const activeHit = useAppSelector(selectActiveHit);
  const searchHits = useAppSelector(selectSearchHits);

  /**
   * The hits of each page, with the index of the hit in the whole document.
   *
   * A page is told which of its boxes belong to the hit the reader is on, so the
   * map has to keep the document-wide index rather than a page-local one.
   */
  const hitsByPage = useMemo(() => {
    const map = new Map<number, Array<{ index: number; boxes: SearchBox[] }>>();
    searchHits.forEach((hit, index) => {
      const list = map.get(hit.pageIndex) ?? [];
      list.push({ index, boxes: hit.boxes });
      map.set(hit.pageIndex, list);
    });
    return map;
  }, [searchHits]);

  return (
    <div className="scroller" ref={scrollerRef}>
      {pdf ? (
        <div
          className={layout === "two" ? "pages is-spread" : "pages"}
          style={{
            ["--zoom" as string]: String(zoom),
            ["--spread-gap" as string]: `${SPREAD_GAP_PX}px`,
          }}
        >
          {pairPages(pdf.pages).map((pair) => (
            <div className="page-spread" key={`${pdf.sourceName}-spread-${pair[0]!.index}`}>
              {pair.map((page) => (
                <PdfPageView
                  key={`${pdf.sourceName}-${page.index}`}
                  page={page}
                  renderZoom={renderZoom}
                  hits={hitsByPage.get(page.index) ?? NO_HITS}
                  activeHit={activeHit}
                  marks={highlights.marks.filter((mark) => mark.page === page.index)}
                  annotations={annotations.ofPage(page.index)}
                  highlighting={highlights.penDown}
                  onStroke={(mark) => highlights.onStroke(page.index, mark)}
                  onMarkContextMenu={(mark, x, y) => highlights.onMenu(page.index, mark, x, y)}
                  annotating={annotations.toolArmed}
                  onAnnotationPoint={(point, x, y) => annotations.onPlace(page.index, point, x, y)}
                  onAnnotationMenu={(pin, x, y) => annotations.onMenu(pin, x, y)}
                  foundAnnotationId={annotations.foundId}
                  movingAnnotationId={annotations.movingId}
                  onAnnotationPress={annotations.onPress}
                  annotationContent={annotations.content}
                  linkActionsRef={linkActionsRef}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <EmptyDocument
          busy={empty.busy}
          onOpenPicker={empty.onOpenPicker}
          onOpenRecent={empty.onOpenRecent}
        />
      )}
    </div>
  );
}
