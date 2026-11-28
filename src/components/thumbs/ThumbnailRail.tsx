/**
 * The pages rail: every page of the open document down the left side, with the
 * page the reader is on marked, plus the backend's status line at its foot.
 *
 * Folded, it keeps its label so it can be opened again, and a sliver of its
 * status line so the app's health still shows when the rail does not.
 *
 * The backend status closes this column instead of sitting in a bar of its own:
 * the rail already runs the window's full height, and a row across the bottom
 * cost the page 30px of its own.
 *
 * Which page is marked, whether the rail is open and how wide it is are all the
 * viewer slice's, read here and written here: a drag on the rail's seam is this
 * component's own business, and the page it sends the reader to is a viewer
 * command.
 */
import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { BackendStatusChip } from "../BackendStatusBar";
import { ThumbnailView } from "../pdf-page/ThumbnailView";
import { sameSpread } from "../../pageLayout";
import type { LoadedPage } from "../../pdf";
import { SHORTCUT } from "../../shortcutHints";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  railOpened,
  railWidthChanged,
  selectCurrentPage,
  selectPageLayout,
  selectRailOpen,
  selectRailWidth,
} from "../../store/slices/viewerSlice";
import { endDragOnBlur } from "../../windowDrag";
import { useViewerCommands } from "../app/viewerCommands";

/** Rail chrome around a thumbnail: 12px pane padding each side plus the 6px
 * padding the .thumb highlight needs, leaving a little slack. */
const RAIL_CHROME = 40;

export type ThumbnailRailProps = {
  pages: LoadedPage[];
  /** Bumped into every thumb's key, so another document's rail is a new rail. */
  sourceName: string;
};

export function ThumbnailRail({ pages, sourceName }: ThumbnailRailProps) {
  const dispatch = useAppDispatch();
  const open = useAppSelector(selectRailOpen);
  const width = useAppSelector(selectRailWidth);
  const currentPage = useAppSelector(selectCurrentPage);
  const layout = useAppSelector(selectPageLayout);
  const { goToPage } = useViewerCommands();
  const paneRef = useRef<HTMLElement>(null);
  const thumbWidth = Math.max(72, width - RAIL_CHROME);

  const onResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pane = paneRef.current;
    if (!pane) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    const startX = event.clientX;
    const startWidth = pane.getBoundingClientRect().width;

    const onMove = (move: PointerEvent) => {
      dispatch(railWidthChanged(startWidth + (move.clientX - startX)));
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      stopOnBlur();
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    };
    // A drag cut short by the window going away has no `pointerup`; see
    // `endDragOnBlur`. The width already followed the pointer, so ending is enough.
    const stopOnBlur = endDragOnBlur(onUp);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  const label = (
    <button
      className="thumbs-label"
      onClick={() => dispatch(railOpened(!open))}
      aria-pressed={open ? "true" : undefined}
      title={`Pages (${SHORTCUT.chord(SHORTCUT.mod, "B")})`}
    >
      Pages
    </button>
  );

  if (!open) {
    return (
      <div className="thumbs-collapsed">
        {label}
        {/* A sliver of rail has no width for a label: the dot alone still says
        the backend is up, and its tooltip carries the address. */}
        <div className="rail-status">
          <BackendStatusChip compact />
        </div>
      </div>
    );
  }

  return (
    <aside className="thumbs-pane" ref={paneRef} style={{ width }}>
      <div className="thumbs-head">{label}</div>
      <nav className="thumbs" aria-label="Page thumbnails">
        {pages.map((page) => (
          <ThumbnailView
            key={`${sourceName}-thumb-${page.index}`}
            page={page}
            width={thumbWidth}
            active={sameSpread(page.index, currentPage, layout)}
            lead={page.index === currentPage}
            onSelect={goToPage}
          />
        ))}
      </nav>
      <div className="rail-status">
        <BackendStatusChip compact />
      </div>
      <div
        className="thumbs-resizer"
        onPointerDown={onResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize page thumbnails"
      />
    </aside>
  );
}
