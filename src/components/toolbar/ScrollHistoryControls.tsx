/**
 * Back and forward through the places the reader has scrolled to.
 *
 * A place is recorded where the scroller came to rest, so this is a history of
 * reading positions rather than of clicks: one step takes the reader back to the
 * passage they were on a moment ago, whatever took them away from it.
 *
 * The history itself is the app slice's (`pdfScrollIndex`); walking it is a viewer
 * command, because it moves the scroller.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAppSelector } from "../../store/hooks";
import { selectPageCount } from "../../store/slices/documentSlice";
import { SHORTCUT } from "../../shortcutHints";
import { useViewerCommands } from "../app/viewerCommands";

export function ScrollHistoryControls() {
  const pageCount = useAppSelector(selectPageCount);
  const canGoBack = useAppSelector((state) => state.app.pdfScrollIndex > 0);
  const canGoForward = useAppSelector((state) => {
    const index = state.app.pdfScrollIndex;
    return index >= 0 && index < state.app.pdfScrollPositions.length - 1;
  });
  const { stepScrollHistory } = useViewerCommands();
  const enabled = pageCount > 0;

  return (
    <div className="toolbar-cluster">
      <button
        type="button"
        className="icon zoom-step"
        onClick={() => stepScrollHistory(-1)}
        disabled={!enabled || !canGoBack}
        aria-label="Previous scroll position"
        title={`Back to the previous scroll position (${SHORTCUT.chord(SHORTCUT.alt, "←")})`}
      >
        <ChevronLeft size={16} aria-hidden />
      </button>
      <button
        type="button"
        className="icon zoom-step"
        onClick={() => stepScrollHistory(1)}
        disabled={!enabled || !canGoForward}
        aria-label="Next scroll position"
        title={`Forward to a more recent scroll position (${SHORTCUT.chord(SHORTCUT.alt, "→")})`}
      >
        <ChevronRight size={16} aria-hidden />
      </button>
    </div>
  );
}
