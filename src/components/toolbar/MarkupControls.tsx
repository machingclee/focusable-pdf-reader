/**
 * The tools that mark the page rather than move it: the highlight pen (and its
 * brush), the annotation tool, and the blur the veil outside the reading strip
 * wears.
 *
 * Both tools are toggles that say so (`aria-pressed`), and both carry their
 * reason when they cannot be armed: a pen whose stroke is still being written
 * elsewhere in the app, or a PDF that is not in the library and so has no row a
 * pin could belong to.
 *
 * The pen and the brush are the viewer slice's; "is another window holding the
 * pen" is the cross-window session's, read here rather than threaded down. Whether
 * the document can hold pins is the library's answer, asked here too: the row
 * exists or it does not.
 */
import { useSyncExternalStore } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { selectPageCount, selectDocumentPath } from "../../store/slices/documentSlice";
import {
  selectAnnotationMode,
  selectHighlightBrush,
  selectHighlightMode,
  annotationToolToggled,
  highlightBrushChanged,
  stripBlurChanged,
} from "../../store/slices/viewerSlice";
import { MAX_BLUR, MIN_BLUR } from "../../viewerLimits";
import { MAX_BRUSH_PT, MIN_BRUSH_PT, highlightSessionId, subscribeHighlightSession } from "../../stripHighlight";
import { pdfDocumentApi } from "../../store/api/pdfDocumentApi";
import { VIEWER_PEN_SESSION_ID } from "../highlight/useHighlightPenSession";
import { useViewerCommands } from "../app/viewerCommands";

export function MarkupControls() {
  const dispatch = useAppDispatch();
  const enabled = useAppSelector(selectPageCount) > 0;
  const highlightMode = useAppSelector(selectHighlightMode);
  const brush = useAppSelector(selectHighlightBrush);
  const annotationMode = useAppSelector(selectAnnotationMode);
  const blur = useAppSelector((state) => state.viewer.stripBlur);
  const openPath = useAppSelector(selectDocumentPath);
  const { toggleHighlightPen } = useViewerCommands();

  const armedPenId = useSyncExternalStore(
    subscribeHighlightSession,
    highlightSessionId,
    highlightSessionId,
  );
  const penBlocked = armedPenId !== null && armedPenId !== VIEWER_PEN_SESSION_ID;

  // A PDF that is not in the library has no row a pin could belong to. Asked here
  // because the toolbar is what offers the tool, and asked leniently: a document
  // nobody has saved yet still answers "no", which is the right refusal.
  const { data: documents } = pdfDocumentApi.endpoints.listDocuments.useQuery(undefined, {
    skip: !openPath,
  });
  const canAnnotate =
    openPath !== null && (documents?.some((document) => document.file_path === openPath) ?? false);

  return (
    <div className="toolbar-cluster">
      <button
        className={highlightMode ? "ghost active" : "ghost"}
        onClick={() => toggleHighlightPen()}
        aria-pressed={highlightMode}
        disabled={!enabled || penBlocked}
        title={
          penBlocked
            ? "Finish the highlight already open"
            : "Highlight this PDF — drag across a line; right-click a highlight to delete it"
        }
      >
        Highlight
      </button>
      {highlightMode && (
        <label className="strip-control" title="Brush size">
          <span>{brush}</span>
          <input
            type="range"
            min={MIN_BRUSH_PT}
            max={MAX_BRUSH_PT}
            value={brush}
            aria-label="Brush size"
            onChange={(event) => dispatch(highlightBrushChanged(Number(event.target.value)))}
          />
        </label>
      )}
      <button
        className={annotationMode ? "ghost active" : "ghost"}
        onClick={() => dispatch(annotationToolToggled())}
        aria-pressed={annotationMode}
        disabled={!enabled}
        title={
          enabled && !canAnnotate
            ? "This PDF is not in the library yet, so it cannot hold annotations"
            : "Annotate this PDF — click anywhere to pin a piece of text; click a pin to edit it, right-click it to copy a reference or delete it"
        }
      >
        Annotate
      </button>
      <label className="strip-control strip-blur" title="Backdrop blur on the veil outside the reading strip.">
        <span>Blur</span>
        <input
          type="range"
          min={MIN_BLUR}
          max={MAX_BLUR}
          value={Math.round(blur)}
          disabled={!enabled}
          aria-label="Blur"
          onChange={(event) => dispatch(stripBlurChanged(Number(event.target.value)))}
        />
        <span className="strip-readout">{Math.round(blur)} px</span>
      </label>
    </div>
  );
}
