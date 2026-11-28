/**
 * The "Notes of this PDF" column, as the workspace draws it.
 *
 * Two shapes, one column: a PDF opened from bytes (a drag from a browser, say) has
 * no path to store strips against, so the column explains itself instead of the
 * toggle appearing to do nothing; a PDF with a path gets the real panel, which is
 * `DocumentNotesPanel`'s own.
 *
 * Popped out, neither is drawn here: the column lives in the other window, which
 * shows the same message for a pathless PDF.
 *
 * What it shows is the store's — which document, whether it is open, the strip a
 * badge asked to see, the card a save asked for — and what it *does* is the
 * viewer's commands: standing the band on a strip, opening a reference, popping
 * the column out. Only the drag on its seam is passed in, because the width is
 * measured from the page area the column takes its room from.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { DocumentNotesPanel } from "../DocumentNotesPanel";
import { PATHLESS_NOTES_MESSAGE } from "../../notesPanel";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  selectDocumentName,
  selectDocumentPath,
  selectPageCount,
} from "../../store/slices/documentSlice";
import {
  pendingEditChanged,
  selectNotesOpen,
  selectPendingEditId,
  selectRevealStripId,
  stripRevealed,
  toastShown,
} from "../../store/slices/panelsSlice";
import { parseViewerRequest } from "../../viewerRequest";
import { useViewerCommands } from "../app/viewerCommands";

export type NotesColumnProps = {
  width: number;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** The panel element, which the resize handler measures. */
  paneRef: React.RefObject<HTMLElement | null>;
};

export function NotesColumn({ width, onResizeStart, paneRef }: NotesColumnProps) {
  const dispatch = useAppDispatch();
  const { parkStrip, revealNote, revealAnnotation, detachNotes } = useViewerCommands();
  const open = useAppSelector(selectNotesOpen);
  const path = useAppSelector(selectDocumentPath);
  const documentName = useAppSelector(selectDocumentName) ?? "";
  const pageCount = useAppSelector(selectPageCount);
  const pendingEditId = useAppSelector(selectPendingEditId);
  const revealId = useAppSelector(selectRevealStripId);
  // A window of its own must not pop the column out again: it would take over the
  // notes window of the app that opened it. Read once — the request is in this
  // window's query string and never changes.
  const inNewWindow = parseViewerRequest() !== null;

  if (path === null) {
    return (
      <aside
        ref={paneRef}
        className={`doc-notes${open ? " is-open" : ""}`}
        style={{ width }}
        aria-label="Notes of this PDF"
      >
        <header className="notes-head">
          <span className="notes-head-title">Notes of this PDF</span>
        </header>
        <p className="notes-message">{PATHLESS_NOTES_MESSAGE}</p>
      </aside>
    );
  }

  return (
    <DocumentNotesPanel
      paneRef={paneRef}
      width={width}
      onResizeStart={onResizeStart}
      open={open}
      filePath={path}
      documentName={documentName}
      pageCount={pageCount}
      onOpenStrip={parkStrip}
      onRevealNote={revealNote}
      onRevealAnnotation={revealAnnotation}
      onStatus={(message) => dispatch(toastShown(message))}
      pendingEditId={pendingEditId}
      onPendingEditHandled={() => dispatch(pendingEditChanged(null))}
      revealId={revealId}
      onRevealHandled={() => dispatch(stripRevealed(null))}
      inNewWindow={inNewWindow}
      // No bridge in the plain web build, so no pop-out there: a second window
      // would have nothing to talk to.
      onDetach={inNewWindow ? undefined : () => detachNotes()}
    />
  );
}
