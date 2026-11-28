import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { clamp } from "../../clamp";
import { MAX_BLUR, MAX_ZOOM, MIN_BLUR, MIN_ZOOM } from "../../viewerLimits";
import { DEFAULT_BRUSH_PT, MAX_BRUSH_PT, MIN_BRUSH_PT, setBrushSize } from "../../stripHighlight";
import type { PageLayout } from "../../pageLayout";
import type { AppTab } from "../../components/TitleBar";

/**
 * What the reader is looking at, and how: the reading view's own state.
 *
 * This lives in the store rather than in the viewer component because it is read
 * by several components that are not each other's parents — the toolbar shows the
 * zoom and the layout, the rail marks the page, the stage draws the strip, the
 * band takes the blur — and every one of them re-rendered whenever *any* state in
 * the viewer's body changed. Read through a selector, a component re-renders when
 * its own field moves and not otherwise, and the viewer stops threading a dozen
 * numbers down through its JSX.
 *
 * Only values that a component renders from belong here. Things measured from the
 * DOM (the scroller's offset, a page's box, the stage's size) and things that
 * cannot be serialised (the loaded PDF) stay with the code that owns them; they
 * are read imperatively and would only put churn into the store.
 *
 * Every reducer clamps its own input, so the bounds live in one place and no
 * caller can put the view in a state the toolbar could not reach.
 */
export type ViewerState = {
  /** Which tab is on screen: the viewer or the Dashboard. */
  view: AppTab;
  zoom: number;
  pageLayout: PageLayout;
  /** The page the counter names — the spread's first page in Two Pages. */
  currentPage: number;
  /** The pages rail is open. */
  railOpen: boolean;
  /** How wide the rail is while it is open, in px. */
  railWidth: number;
  /** The reading strip's height, in PDF points. */
  stripHeight: number;
  /** The blur the veil outside the strip wears, in px. */
  stripBlur: number;
  /** The reading strip is on. */
  focusMode: boolean;
  /** The toolbar pen is down: a drag on a page lays a stroke. */
  highlightMode: boolean;
  /** The pen's size, in PDF points. */
  highlightBrush: number;
  /** The annotation tool is armed: a click on a page places a pin. */
  annotationMode: boolean;
};

export const MIN_RAIL = 132;
export const MAX_RAIL = 360;
export const DEFAULT_RAIL = 176;
export const MIN_STRIP = 10;
export const MAX_STRIP = 640;
export const DEFAULT_STRIP = 160;
export const DEFAULT_BLUR = 5;

/** What the reader's saved preferences start the view at. */
export type ViewerInitialState = {
  view?: AppTab;
  pageLayout: PageLayout;
  railOpen: boolean;
  stripHeight: number;
  stripBlur: number;
};

export function initialViewerState({
  view = "pdf",
  pageLayout,
  railOpen,
  stripHeight,
  stripBlur,
}: ViewerInitialState): ViewerState {
  return {
    view,
    zoom: 1,
    pageLayout,
    currentPage: 1,
    railOpen,
    railWidth: DEFAULT_RAIL,
    stripHeight: clamp(stripHeight, MIN_STRIP, MAX_STRIP),
    stripBlur: clamp(stripBlur, MIN_BLUR, MAX_BLUR),
    focusMode: false,
    highlightMode: false,
    highlightBrush: DEFAULT_BRUSH_PT,
    annotationMode: false,
  };
}

const viewerSlice = createSlice({
  name: "viewer",
  initialState: () => initialViewerState({ pageLayout: "single", railOpen: true, stripHeight: DEFAULT_STRIP, stripBlur: DEFAULT_BLUR }),
  reducers: {
    /**
     * Apply what this window starts at: its saved preferences, and — in a viewer
     * window opened on one passage — the layout and folded rail that window was
     * opened for. Dispatched once, by the component that read them.
     */
    viewerInitialized(state, action: PayloadAction<ViewerInitialState>) {
      const next = initialViewerState(action.payload);
      state.view = next.view;
      state.pageLayout = next.pageLayout;
      state.railOpen = next.railOpen;
      state.stripHeight = next.stripHeight;
      state.stripBlur = next.stripBlur;
    },
    viewShown(state, action: PayloadAction<AppTab>) {
      state.view = action.payload;
    },
    zoomChanged(state, action: PayloadAction<number>) {
      state.zoom = clamp(action.payload, MIN_ZOOM, MAX_ZOOM);
    },
    /** The zoom a layout change settles on, already computed against the area. */
    layoutChanged(state, action: PayloadAction<PageLayout>) {
      state.pageLayout = action.payload;
    },
    pageShown(state, action: PayloadAction<number>) {
      state.currentPage = Math.max(1, Math.round(action.payload));
    },
    railToggled(state) {
      state.railOpen = !state.railOpen;
    },
    railOpened(state, action: PayloadAction<boolean>) {
      state.railOpen = action.payload;
    },
    railWidthChanged(state, action: PayloadAction<number>) {
      state.railWidth = clamp(Math.round(action.payload), MIN_RAIL, MAX_RAIL);
    },
    stripHeightChanged(state, action: PayloadAction<number>) {
      state.stripHeight = clamp(Math.round(action.payload), MIN_STRIP, MAX_STRIP);
    },
    stripBlurChanged(state, action: PayloadAction<number>) {
      state.stripBlur = clamp(Math.round(action.payload), MIN_BLUR, MAX_BLUR);
    },
    focusModeChanged(state, action: PayloadAction<boolean>) {
      state.focusMode = action.payload;
    },
    /**
     * The band's height, as the drag on its border has it. Points, like the store
     * value, so a drag and a key press write the same units.
     */
    bandDragged(state, action: PayloadAction<number>) {
      state.stripHeight = clamp(Math.round(action.payload), MIN_STRIP, MAX_STRIP);
    },
    /**
     * The pen, on or off. Arming it puts the annotation tool away — one tool at a
     * time, because a click with the pen down lays a stroke and a click with the
     * annotation tool down pins a note, and the reader cannot mean both. Arming
     * also sizes the brush from the text under the pointer, when there was any.
     */
    highlightPenToggled(state, action: PayloadAction<number | null | undefined>) {
      if (state.highlightMode) {
        state.highlightMode = false;
        return;
      }
      state.highlightMode = true;
      state.annotationMode = false;
      state.highlightBrush = clamp(
        setBrushSize(action.payload ?? DEFAULT_BRUSH_PT),
        MIN_BRUSH_PT,
        MAX_BRUSH_PT,
      );
    },
    /** The pen put down or picked up by something other than its own toggle. */
    highlightModeSet(state, action: PayloadAction<boolean>) {
      state.highlightMode = action.payload;
    },
    /** A stroke's size, from the menu that measured it or the pen's own slider. */
    highlightBrushChanged(state, action: PayloadAction<number>) {
      state.highlightBrush = clamp(setBrushSize(action.payload), MIN_BRUSH_PT, MAX_BRUSH_PT);
    },
    /** The annotation tool, on or off — and it puts the pen down, for the same reason. */
    annotationToolToggled(state) {
      state.annotationMode = !state.annotationMode;
      if (state.annotationMode) state.highlightMode = false;
    },
    annotationToolArmed(state, action: PayloadAction<boolean>) {
      state.annotationMode = action.payload;
      if (action.payload) state.highlightMode = false;
    },
    /** A document is open: the view starts at its first page, with no band. */
    documentOpened(state) {
      state.currentPage = 1;
      state.focusMode = false;
      state.highlightMode = false;
      state.annotationMode = false;
    },
  },
});

export const {
  viewerInitialized,
  viewShown,
  zoomChanged,
  layoutChanged,
  pageShown,
  railToggled,
  railOpened,
  railWidthChanged,
  stripHeightChanged,
  stripBlurChanged,
  focusModeChanged,
  bandDragged,
  highlightPenToggled,
  highlightModeSet,
  highlightBrushChanged,
  annotationToolToggled,
  annotationToolArmed,
  documentOpened: viewerDocumentOpened,
} = viewerSlice.actions;

export default viewerSlice.reducer;

/** The shape of the store this slice needs, for its own selectors. */
type WithViewer = { viewer: ViewerState };
export const selectViewer = (state: WithViewer) => state.viewer;
export const selectZoom = (state: WithViewer) => state.viewer.zoom;
export const selectPageLayout = (state: WithViewer) => state.viewer.pageLayout;
export const selectCurrentPage = (state: WithViewer) => state.viewer.currentPage;
export const selectRailOpen = (state: WithViewer) => state.viewer.railOpen;
export const selectRailWidth = (state: WithViewer) => state.viewer.railWidth;
export const selectStripHeight = (state: WithViewer) => state.viewer.stripHeight;
export const selectStripBlur = (state: WithViewer) => state.viewer.stripBlur;
export const selectFocusMode = (state: WithViewer) => state.viewer.focusMode;
export const selectHighlightMode = (state: WithViewer) => state.viewer.highlightMode;
export const selectHighlightBrush = (state: WithViewer) => state.viewer.highlightBrush;
export const selectAnnotationMode = (state: WithViewer) => state.viewer.annotationMode;
export const selectView = (state: WithViewer) => state.viewer.view;
