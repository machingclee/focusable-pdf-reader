/**
 * The Notes tab: every document the backend knows, and the strips of the one you
 * pick.
 *
 * Owns its own queries — the document list here, the strips inside `StripList` —
 * and its own selection. The only thing it does not own is what "open this strip
 * in the viewer" means, which is the page's job, so that comes in as one callback.
 */
import { useMemo, useState } from "react";
import { apiErrorMessage } from "../store/api/baseApi";
import { pdfDocumentApi } from "../store/api/pdfDocumentApi";
import { formatSavedAt } from "../notesText";
import type { FocusableStrip, PdfDocumentListItem } from "../types/dto";
import { StripList } from "./StripList";

export type NotesViewProps = {
  /** Open this strip in the viewer. */
  onOpenStrip: (document: PdfDocumentListItem, strip: FocusableStrip) => void;
  /** Page-level status line, for backend errors and confirmations. */
  onStatus?: (message: string) => void;
  pendingEditId?: number | null;
  onPendingEditHandled?: () => void;
};

export function NotesView({
  onOpenStrip,
  onStatus,
  pendingEditId = null,
  onPendingEditHandled,
}: NotesViewProps) {
  const { data: allDocuments = [], isLoading, isError, error } = pdfDocumentApi.endpoints.listDocuments.useQuery();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Documents with no strips are noise here: this tab can only show strips.
  const documents = useMemo(
    () => allDocuments.filter((document) => (document._count?.focusable_strips ?? 0) > 0),
    [allDocuments],
  );

  // Keep a selection without overriding the user's: the first document opens
  // itself so the tab is never an empty right-hand pane.
  const selectedDocument =
    documents.find((document) => document.id === selectedId) ?? documents[0] ?? null;

  const errorMessage = isError ? (apiErrorMessage(error) ?? "Could not load documents.") : null;

  return (
    <div className="notes">
      <section className="notes-documents" aria-label="Documents">
        <header className="notes-head">
          <span className="notes-head-title">Documents</span>
          <span className="notes-count">{documents.length}</span>
        </header>

        {isLoading && documents.length === 0 && <p className="notes-message">Loading…</p>}
        {errorMessage && <p className="notes-message is-error">{errorMessage}</p>}
        {!isLoading && !errorMessage && documents.length === 0 && (
          <p className="notes-message">
            No saved strips yet. Park a strip in the PDF tab, right-click it and choose{" "}
            <strong>Save strip</strong>.
          </p>
        )}

        <ul className="notes-doc-list">
          {documents.map((document) => {
            const active = document.id === selectedDocument?.id;
            return (
              <li key={document.id}>
                <button
                  type="button"
                  className={`notes-doc${active ? " is-active" : ""}`}
                  onClick={() => setSelectedId(document.id)}
                  aria-pressed={active}
                  title={document.file_path}
                >
                  <span className="notes-doc-name">{document.name}</span>
                  <span className="notes-doc-meta">
                    <span className="notes-doc-time">{formatSavedAt(document.created_at)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="notes-strips" aria-label="Saved strips">
        <header className="notes-head">
          <span className="notes-head-title" title={selectedDocument?.file_path}>
            {selectedDocument?.name ?? "Strips"}
          </span>
        </header>

        {selectedDocument ? (
          <StripList
            // A different document is a different list: remount so local editing
            // state and the pending-edit request do not leak across documents.
            key={selectedDocument.id}
            pdfDocumentId={selectedDocument.id}
            filePath={selectedDocument.file_path}
            documentName={selectedDocument.name}
            emptyMessage="This document has no saved strips."
            onOpenStrip={(strip) => onOpenStrip(selectedDocument, strip)}
            onStatus={onStatus}
            pendingEditId={pendingEditId}
            onPendingEditHandled={onPendingEditHandled}
          />
        ) : (
          <p className="notes-message">Pick a document to see its notes.</p>
        )}

        {selectedDocument && (
          <p className="notes-hint">
            Drag a handle to reorder a folder or a strip · click a strip to open it · double-click a note to edit it ·
            right-click for more
          </p>
        )}
      </section>
    </div>
  );
}
