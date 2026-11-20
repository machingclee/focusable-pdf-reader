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
 */
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
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
  /** Whether the column is in its open state (drives the slide animation). */
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
      className={`doc-notes${open ? " is-open" : ""}`}
      ref={paneRef as RefObject<HTMLElement>}
      style={{ width }}
      aria-label="Notes of this PDF"
    >
      {/* Left edge, so dragging towards the page widens the column. */}
      <div
        className="doc-notes-resizer"
        onPointerDown={onResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize notes of this PDF"
      />

      <header className="notes-head">
        <span className="notes-head-title">Notes of this PDF</span>
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
          emptyMessage="No saved strips in this PDF yet. Right-click the reading band and choose Save strip."
          onOpenStrip={onOpenStrip}
          onStatus={onStatus}
          pendingEditId={pendingEditId}
          onPendingEditHandled={onPendingEditHandled}
        />
      )}
    </aside>
  );
}
