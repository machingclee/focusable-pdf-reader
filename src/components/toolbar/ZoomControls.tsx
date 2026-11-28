/**
 * What the page is shown at, and the find box that looks through it: the page
 * layout, the zoom steppers and readout, Fit, and Find.
 *
 * The steppers are icons rather than the `−` / `+` characters: a glyph sits on
 * the font's baseline in whatever width the font gives it, so the two halves of
 * one control were different sizes and neither was centred in its square. A 15px
 * stroked icon is the same mark in both, inside the row's own pill height
 * (`.zoom-step`).
 *
 * The layout and the readout are the viewer slice's; the moves are commands,
 * because each one measures the page area before it changes anything.
 */
import { Minus, Plus } from "lucide-react";
import { PageLayoutMenu } from "../PageLayoutMenu";
import { useAppSelector } from "../../store/hooks";
import { selectPageCount } from "../../store/slices/documentSlice";
import { selectPageLayout, selectZoom } from "../../store/slices/viewerSlice";
import { selectSearchOpen } from "../../store/slices/searchSlice";
import { useViewerCommands } from "../app/viewerCommands";
import { ZOOM_STEP } from "../../viewerLimits";

export function ZoomControls() {
  const enabled = useAppSelector(selectPageCount) > 0;
  const layout = useAppSelector(selectPageLayout);
  const zoom = useAppSelector(selectZoom);
  const findOpen = useAppSelector(selectSearchOpen);
  const { chooseLayout, zoomBy, fitWidth, openSearch } = useViewerCommands();

  return (
    <div className="toolbar-cluster">
      <PageLayoutMenu layout={layout} onChange={chooseLayout} />
      <button
        className="icon zoom-step"
        onClick={() => zoomBy(1 / ZOOM_STEP)}
        disabled={!enabled}
        aria-label="Zoom out"
      >
        <Minus size={15} aria-hidden />
      </button>
      <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
      <button
        className="icon zoom-step"
        onClick={() => zoomBy(ZOOM_STEP)}
        disabled={!enabled}
        aria-label="Zoom in"
      >
        <Plus size={15} aria-hidden />
      </button>
      <button className="ghost" onClick={() => fitWidth()} disabled={!enabled}>
        Fit
      </button>
      <button
        className={findOpen ? "ghost active" : "ghost"}
        onClick={() => openSearch()}
      >
        Find
      </button>
    </div>
  );
}
