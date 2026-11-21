/**
 * The "Notes of this PDF" panel: the open document's strips, docked beside the
 * page instead of replacing it.
 *
 * It owns the document lookup and the strip list; the host only says which file is
 * open (`filePath` / `documentName`) and how wide the column is. Resolving the
 * document is an idempotent upsert the query layer caches, so opening the panel
 * also registers a PDF that has no strips yet.
 *
 * A drag on the left edge is the host's business (it owns and remembers the
 * width), so `onResizeStart` is the one imperative prop it hands down.
 *
 * The same component is the whole content of the popped-out window: there the
 * column is the window rather than one of two columns sharing it, so it has no
 * width of its own and no resizer (`detached`), and it offers a button back
 * instead of a button out.
 */
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { ExternalLink, PanelRightClose } from "lucide-react";
import { apiErrorMessage } from "../store/api/baseApi";
import { pdfDocumentApi } from "../store/api/pdfDocumentApi";
import type { FocusableStrip } from "../types/dto";
import { StripList } from "./StripList";

export type DocumentNotesPanelProps = {
  /** Measured by the host's resize handler to know the drag's starting width. */
  paneRef: RefObject<HTMLElement | null>;
  /** Column width in px; owned by the caller, which also remembers it. */
  width: number;
  /** Starts a drag on the left edge. */
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Whether the column is on screen: closed, it takes no room in the row. */
  open: boolean;
  /** The open PDF: identity only, no rows. */
  filePath: string;
  documentName: string;
  pageCount?: number;
  /** Ask the viewer to park this strip. */
  onOpenStrip: (strip: FocusableStrip) => void;
  /** Page-level status line. */
  onStatus?: (message: string) => void;
  pendingEditId?: number | null;
  onPendingEditHandled?: () => void;
  /** Strip a note badge asked to see: its card is scrolled to and selected. */
  revealId?: number | null;
  onRevealHandled?: () => void;
  /** Rendered as its own window: fills it, with no width of its own and no seam. */
  detached?: boolean;
  /** Shows a pop-out button in the header (main window only). */
  onDetach?: () => void;
  /** Shows a dock button in the header (detached window only). */
  onDock?: () => void;
};

export function DocumentNotesPanel({
  paneRef,
  width,
  onResizeStart,
  open,
  filePath,
  documentName,
  pageCount,
  onOpenStrip,
  onStatus,
  pendingEditId = null,
  onPendingEditHandled,
  revealId = null,
  onRevealHandled,
  detached = false,
  onDetach,
  onDock,
}: DocumentNotesPanelProps) {
  const {
    data: document,
    isLoading,
    isError,
    error,
  } = pdfDocumentApi.endpoints.getOrCreateDocument.useQuery({
    file_path: filePath,
    name: documentName,
    page_count: pageCount,
  });

  const errorMessage = isError ? (apiErrorMessage(error) ?? "Could not load this PDF's notes.") : null;

  return (
    <aside
      className={`doc-notes${open ? " is-open" : ""}${detached ? " is-detached" : ""}`}
      ref={paneRef as RefObject<HTMLElement>}
      // The detached column fills its window: a width from the main window would
      // only make it a narrow strip of a wide one.
      style={detached ? undefined : { width }}
      aria-label="Notes of this PDF"
    >
      {/* Left edge, so dragging towards the page widens the column. */}
      {!detached && (
        <div
          className="doc-notes-resizer"
          onPointerDown={onResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize notes of this PDF"
          // The handle is the panel's own left border (see `.doc-notes-resizer`),
          // which says "movable" without a word; the tooltip says how far that
          // goes, including the gesture that closes the column.
          title="Drag to resize · drag it shut to close"
        />
      )}

      <header className="notes-head">
        <span className="notes-head-title">Notes of this PDF</span>
        {detached && onDock && (
          <button
            type="button"
            className="ghost notes-head-button"
            onClick={onDock}
            title="Dock the notes back into the viewer"
            aria-label="Dock the notes back into the viewer"
          >
            <PanelRightClose size={18} aria-hidden />
          </button>
        )}
        {/* Only the main window offers the pop-out: a window cannot be popped out
            of itself. */}
        {!detached && onDetach && (
          <button
            type="button"
            className="ghost notes-head-button"
            onClick={onDetach}
            title="Open these notes in their own window"
            aria-label="Open these notes in their own window"
          >
            <ExternalLink size={18} aria-hidden />
          </button>
        )}
      </header>

      {errorMessage && <p className="notes-message is-error">{errorMessage}</p>}
      {!errorMessage && (isLoading || !document) && (
        <p className="notes-message">Loading this document’s notes…</p>
      )}

      {document && (
        <StripList
          key={document.id}
          pdfDocumentId={document.id}
          filePath={document.file_path}
          documentName={document.name}
          emptyMessage="No saved strips in this PDF yet. Right-click the reading band and choose Save note."
          onOpenStrip={onOpenStrip}
          onStatus={onStatus}
          pendingEditId={pendingEditId}
          onPendingEditHandled={onPendingEditHandled}
          revealId={revealId}
          onRevealHandled={onRevealHandled}
        />
      )}
    </aside>
  );
}
