/**
 * The stage: the page column and everything the reader's gestures put over it.
 *
 * It owns no state. Each overlay arrives already decided — a `null` is the
 * overlay not being shown — because whether a strip menu, a pin's editor or the
 * focus veil is up is the viewer's business, not the stage's; the stage is only
 * the box those things meet in. That keeps one place (`App`) deciding what is on
 * screen, and one place (here) deciding how the stage is layered.
 *
 * Order is the layering, and it is deliberate:
 *
 * - the find bar sits above the pages, because it is chrome;
 * - the pages ride in a scroller of their own, so a long document can scroll
 *   without the overlays leaving;
 * - the remark badges are a layer above the veil: in focus mode the band covers
 *   the strip a badge sits on, and a badge under it could not be clicked;
 * - the focus veil covers everything outside the reading strip, and the drag
 *   rectangle is drawn above it so its edges stay visible over what it crosses;
 * - the menus and editors come last, in viewport coordinates (their shells
 *   portal them), so nothing on the page can cover them.
 */
import type {
  ComponentProps,
  PointerEvent as ReactPointerEvent,
  RefObject,
  MouseEvent as ReactMouseEvent,
} from "react";
import { SearchBar } from "../search/SearchBar";
import { PagesColumn, type PagesColumnProps } from "../pdf-page/PagesColumn";
import { RemarkLayer, type RemarkLayerProps } from "./RemarkLayer";
import { FocusOverlay, type FocusOverlayProps } from "./FocusOverlay";
import { DisplayStripMenu, type DisplayStripMenuProps } from "./DisplayStripMenu";
import { PageContextMenu } from "../PageContextMenu";
import { HighlightContextMenu } from "../HighlightContextMenu";
import { AnnotationOverlays, type AnnotationOverlaysProps } from "../annotation/AnnotationOverlays";

export type ViewerStageProps = {
  stageRef: RefObject<HTMLDivElement | null>;
  /** The gestures the whole stage answers: strip drags, pans, double-clicks, menus. */
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
  onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  /** The find bar, when it is open. */
  search: ComponentProps<typeof SearchBar> | null;
  pages: PagesColumnProps;
  /** The note badges, when the document has any remarked strip. */
  remarks: RemarkLayerProps | null;
  /** The focus veil, when focus mode is on. */
  focus: FocusOverlayProps | null;
  /**
   * The rectangle a `⌘`-drag is drawing. Always mounted: the first frame of a
   * fast drag would otherwise be lost.
   */
  selectBandRef: RefObject<HTMLDivElement | null>;
  /** The reading band's menu, when it is open. */
  stripMenu: DisplayStripMenuProps | null;
  /** The page's menu, for a right-click outside the reading strip. */
  pageMenu: Parameters<typeof PageContextMenu>[0] | null;
  /** One pin's editor and menu, each shown only when it is open. */
  annotations: AnnotationOverlaysProps;
  /** One saved highlight's menu, opened by right-clicking the stroke. */
  highlightMenu: ComponentProps<typeof HighlightContextMenu> | null;
};

export function ViewerStage({
  stageRef,
  onPointerDown,
  onPointerMove,
  onPointerLeave,
  onDoubleClick,
  onContextMenu,
  search,
  pages,
  remarks,
  focus,
  selectBandRef,
  stripMenu,
  pageMenu,
  annotations,
  highlightMenu,
}: ViewerStageProps) {
  return (
    <div
      className="stage"
      ref={stageRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {search && <SearchBar {...search} />}

      <PagesColumn {...pages} />

      {remarks && <RemarkLayer {...remarks} />}

      {focus && <FocusOverlay {...focus} />}

      {/* The area a `⌘`-drag is drawing, above the veil so its edges are visible
      over whatever it crosses. Position comes from the drag (`startStripSelect`
      writes `top` and `height` per move), and it never takes a pointer event of
      its own. */}
      <div className="strip-select" ref={selectBandRef} aria-hidden="true" />

      {stripMenu && <DisplayStripMenu {...stripMenu} />}

      {pageMenu && <PageContextMenu {...pageMenu} />}

      <AnnotationOverlays {...annotations} />

      {highlightMenu && <HighlightContextMenu {...highlightMenu} />}
    </div>
  );
}
