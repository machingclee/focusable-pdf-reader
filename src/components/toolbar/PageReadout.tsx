/**
 * The page readout: which page is being read, out of how many, and the box that
 * jumps to another one — plus the window's own error line beside it.
 *
 * With no document the same space says so, so the row does not reflow when one
 * opens. The box is a form: Return jumps, and a value that is not a number puts
 * the readout back instead of leaving the box holding junk.
 *
 * The box's text is the box's own. It follows the page being read — a scroll, a
 * search hit, a saved strip all move the counter — except while the reader has the
 * caret in it, because rewriting the field they are typing in would fight them.
 */
import { useEffect, useRef, useState } from "react";
import { clamp } from "../../clamp";
import { useAppSelector } from "../../store/hooks";
import { selectError, selectPageCount } from "../../store/slices/documentSlice";
import { selectCurrentPage, selectPageLayout } from "../../store/slices/viewerSlice";
import { spreadEnd } from "../../pageLayout";
import { useViewerCommands } from "../app/viewerCommands";

export function PageReadout() {
  const pageCount = useAppSelector(selectPageCount);
  const currentPage = useAppSelector(selectCurrentPage);
  const layout = useAppSelector(selectPageLayout);
  const error = useAppSelector(selectError);
  const { goToPage } = useViewerCommands();

  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(String(currentPage));

  useEffect(() => {
    if (inputRef.current === document.activeElement) return;
    setDraft(String(currentPage));
  }, [currentPage]);

  // The page the counter names beside the current one, in Two Pages mode.
  const facingPage = pageCount > 0 ? spreadEnd(currentPage, pageCount, layout) : null;

  return (
    <div className="toolbar-cluster page-meta">
      <div className="file-meta">
        {pageCount === 0 ? (
          "No document open"
        ) : (
          <form
            className="page-jump"
            onSubmit={(event) => {
              event.preventDefault();
              const next = Number.parseInt(draft, 10);
              if (!Number.isFinite(next)) {
                setDraft(String(currentPage));
                return;
              }
              goToPage(clamp(Math.round(next), 1, pageCount));
              inputRef.current?.blur();
            }}
          >
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              value={draft}
              aria-label="Page number"
              onChange={(event) => setDraft(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={() => setDraft(String(currentPage))}
            />
            {facingPage != null && <span className="page-jump-mate">– {facingPage}</span>}
            <span>/ {pageCount}</span>
          </form>
        )}
      </div>
      {error && <span className="status-error">{error}</span>}
    </div>
  );
}
