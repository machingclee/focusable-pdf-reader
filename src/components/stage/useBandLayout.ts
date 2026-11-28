/**
 * Where the reading band and the note badges are on screen.
 *
 * Both are drawn in layers of their own above the page — the band because it is a
 * hole painted over everything else, the badges because in focus mode the band
 * covers the passage a badge belongs to and a badge under it could not be clicked
 * — and neither can ride the page's own scroll. So their place is rewritten from
 * the pages' boxes by this pass: on a resize (window, pages rail, notes column), a
 * zoom, a new strip height, a change of lock, a different strip list, a newly
 * opened document, and on every scroll frame.
 *
 * The order inside the pass is not free: the band is laid out first, because the
 * badge pass reads the reading hole off it to dim the badges outside it.
 *
 * A band whose page has scrolled away keeps its place in stage coordinates (the
 * overlay clips it); a badge whose page has left the stage is hidden, and the icon
 * leaves with the passage's top edge while its line stays for whatever of the
 * passage is still on screen.
 */
import { useCallback, useEffect, useLayoutEffect } from "react";
import type { RefObject } from "react";
import type { Note } from "../../types/dto";
import type { PageLayout } from "../../pageLayout";
import { pageElementAtPoint, type ContentLock } from "../../pdfPageGeometry";
import { pageHoleSpan } from "../../pageLayout";
import { remarkMarkerLeft, remarkMarkerVertical } from "../../stripRemark";

/**
 * The strip's hole as the drag in progress has it, in stage coordinates: written
 * by the band resize handlers and read here, so the hole follows the hand.
 */
export type DragLock = {
  holeTop: number;
  holeHeight: number;
};

/** On-screen CSS px for a strip measured in PDF points (1pt = 1px at 100% zoom). */
function stripScreenPx(pt: number, zoom: number): number {
  return pt * zoom;
}

export type BandLayoutOptions = {
  stageRef: RefObject<HTMLDivElement | null>;
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** The veil, whose `--hole-*` custom properties are the band's geometry. */
  overlayRef: RefObject<HTMLDivElement | null>;
  /** One badge element per remarked strip, in draw order. */
  badgeNodes: RefObject<Map<number, HTMLButtonElement>>;
  /** The strips wearing a badge, as the layout pass sees them. */
  strips: RefObject<Note[]>;
  /** The band's centre in stage coordinates: its place on the page, not the screen. */
  bandCenterY: (stage: HTMLElement) => number;
  /* The live values, read without waiting for a render. */
  focusModeRef: RefObject<boolean>;
  layoutRef: RefObject<PageLayout>;
  stripHeightRef: RefObject<number>;
  zoomRef: RefObject<number>;
  /** The strip being dragged, whose hole is drawn where the hand is. */
  dragLockRef: RefObject<DragLock | null>;
  /** The page the band is locked to, when it is locked to one. */
  contentLockRef: RefObject<ContentLock | null>;
  /** What a re-layout is triggered by. */
  trigger: {
    focusMode: boolean;
    pdfOpen: boolean;
    stripCount: number;
    /** The stage's measured size. */
    stage: { width: number; height: number };
    layout: PageLayout;
    stripHeight: number;
    zoom: number;
  };
};

export type BandLayout = {
  /** Band first, then the badges that are dimmed against the hole it wrote. */
  layoutOverlays: () => void;
  /** The band's hole alone, for when the hole moved but the badges did not. */
  layoutBand: () => void;
  /** The badges alone. */
  layoutBadges: () => void;
};

export function useBandLayout({
  stageRef,
  scrollerRef,
  overlayRef,
  badgeNodes,
  strips,
  bandCenterY,
  focusModeRef,
  layoutRef,
  stripHeightRef,
  zoomRef,
  dragLockRef,
  contentLockRef,
  trigger,
}: BandLayoutOptions): BandLayout {
  /**
   * Place one badge per remarked strip, on the strip's own top edge at the left
   * of its page.
   */
  const layoutBadges = useCallback(() => {
    const stage = stageRef.current;
    const scroller = scrollerRef.current;
    const nodes = badgeNodes.current;
    if (!stage || !scroller || !nodes || nodes.size === 0) return;
    const stageRect = stage.getBoundingClientRect();
    const zoom = zoomRef.current || 1;
    const overlay = overlayRef.current;
    /* The hole is read off the overlay's custom properties rather than measured
       again: `layoutBand` wrote them, and it runs before this pass. */
    const holeTop = Number.parseFloat(overlay?.style.getPropertyValue("--hole-top") ?? "");
    const holeHeight = Number.parseFloat(overlay?.style.getPropertyValue("--hole-height") ?? "");
    const holeKnown = focusModeRef.current && Number.isFinite(holeTop) && Number.isFinite(holeHeight);
    const pageRects = new Map<number, DOMRect | null>();

    for (const strip of strips.current) {
      const node = nodes.get(strip.id);
      if (!node) continue;
      let pageRect = pageRects.get(strip.page_number);
      if (pageRect === undefined) {
        const page = scroller.querySelector<HTMLElement>(`[data-page="${strip.page_number}"]`);
        pageRect = page ? page.getBoundingClientRect() : null;
        pageRects.set(strip.page_number, pageRect);
      }
      /* The strip's own top edge, in stage px: what the badge lines up with, and
         what decides whether it is under the veil. */
      const edge = pageRect ? pageRect.top - stageRect.top + strip.top * zoom : Number.NaN;
      const onStage =
        pageRect !== null &&
        pageRect.right > stageRect.left + 4 &&
        pageRect.left < stageRect.right - 4;
      const placed = onStage
        ? remarkMarkerVertical(edge, strip.height * zoom, stageRect.height)
        : null;
      node.style.visibility = placed ? "visible" : "hidden";
      if (!placed || pageRect === null) continue;
      /* The badge stays on the strip's own edge, including once that edge has
         left the stage. The layer clips the icon as it goes; the line is the
         passage, so it remains while any of the passage is still on screen. */
      node.style.top = `${placed.top}px`;
      node.style.left = `${remarkMarkerLeft(pageRect.left - stageRect.left, stageRect.width)}px`;
      node.style.setProperty("--stem-height", `${placed.stemHeight}px`);
      node.classList.add("is-placed");
      const veiled = holeKnown && (edge < holeTop || edge > holeTop + holeHeight);
      node.classList.toggle("is-veiled", veiled);
    }
  }, [badgeNodes, focusModeRef, overlayRef, scrollerRef, stageRef, strips, zoomRef]);

  /**
   * The hole's width.
   *
   * Single Page leaves it the full stage. Two Pages cuts it to the page the strip
   * is locked to — a saved note's page, or the page a double-click parked it on —
   * so the clear band does not open the facing page as well. A page that has
   * scrolled off the side leaves no hole there.
   */
  const placeHoleSpan = useCallback((stage: HTMLElement, overlay: HTMLElement) => {
    const scroller = scrollerRef.current;
    const fullStage = () => {
      overlay.classList.remove("is-paged-hole");
      overlay.style.setProperty("--hole-left", "0px");
      overlay.style.setProperty("--hole-width", "100%");
    };
    if (layoutRef.current !== "two" || !scroller) {
      fullStage();
      return;
    }
    const lock = contentLockRef.current;
    const stageRect = stage.getBoundingClientRect();
    const locked = lock
      ? scroller.querySelector<HTMLElement>(`[data-page="${lock.page}"]`)
      : null;
    const holeTop = Number.parseFloat(overlay.style.getPropertyValue("--hole-top")) || 0;
    const page = locked ?? pageElementAtPoint(
      scroller,
      stageRect.left + stageRect.width / 2,
      stageRect.top + holeTop,
    );
    if (!page) {
      fullStage();
      return;
    }
    const pageRect = page.getBoundingClientRect();
    const span = pageHoleSpan(
      stageRect.width,
      pageRect.left - stageRect.left,
      pageRect.right - stageRect.left,
    );
    overlay.classList.add("is-paged-hole");
    overlay.style.setProperty("--hole-left", `${span.left}px`);
    overlay.style.setProperty("--hole-width", `${span.width}px`);
  }, [contentLockRef, layoutRef, scrollerRef]);

  /** Draw the band's hole: where the hand left it, or where the reading lock is. */
  const layoutBand = useCallback(() => {
    const stage = stageRef.current;
    const overlay = overlayRef.current;
    if (!stage || !overlay) return;
    const drag = dragLockRef.current;
    if (drag) {
      overlay.style.setProperty("--hole-top", `${drag.holeTop}px`);
      overlay.style.setProperty("--hole-height", `${drag.holeHeight}px`);
      placeHoleSpan(stage, overlay);
      return;
    }
    const height = stripScreenPx(stripHeightRef.current, zoomRef.current);
    const centerY = bandCenterY(stage);
    overlay.style.setProperty("--hole-top", `${centerY - height / 2}px`);
    overlay.style.setProperty("--hole-height", `${height}px`);
    placeHoleSpan(stage, overlay);
  }, [bandCenterY, dragLockRef, overlayRef, placeHoleSpan, stageRef, stripHeightRef, zoomRef]);

  const layoutOverlays = useCallback(() => {
    layoutBand();
    layoutBadges();
  }, [layoutBadges, layoutBand]);

  // Everything the viewport decides: the band, and the badges that hang off it.
  useLayoutEffect(() => {
    if (trigger.focusMode) layoutBand();
    layoutBadges();
  }, [
    layoutBadges,
    layoutBand,
    trigger.focusMode,
    trigger.layout,
    trigger.pdfOpen,
    trigger.stage.height,
    trigger.stage.width,
    trigger.stripCount,
    trigger.stripHeight,
    trigger.zoom,
  ]);

  // And everything the scroll decides: both ride pages, so both move with them.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (!trigger.focusMode && trigger.stripCount === 0) return;
    const onScroll = () => {
      if (trigger.focusMode) layoutBand();
      layoutBadges();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [layoutBadges, layoutBand, scrollerRef, trigger.focusMode, trigger.stripCount]);

  return { layoutOverlays, layoutBand, layoutBadges };
}
