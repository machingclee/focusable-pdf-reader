/**
 * The Notes tab: every document the backend knows, and the strips of the one you
 * pick.
 *
 * Owns its own queries — the document list here, the strips inside `StripList` —
 * and its own selection. The only thing it does not own is what "open this strip
 * in the viewer" means, which is the page's job, so that comes in as one callback.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { apiErrorMessage } from "../store/api/baseApi";
import { pdfDocumentApi } from "../store/api/pdfDocumentApi";
import { formatSavedAt } from "../notesText";
import { planSubsetReorder } from "../stripOrder";
import type { FocusableStrip, PdfDocumentListItem } from "../types/dto";
import { DocumentContextMenu } from "./DocumentContextMenu";
import { DocumentPagePreview, type DocumentPagePreviewHandle } from "./DocumentPagePreview";
import { SortableItem } from "./dnd/SortableItem";
import { StripList } from "./StripList";

/** Pointer travel, in px, before a press on a document becomes a drag. */
const DRAG_DISTANCE_PX = 6;
/** How long the pointer must rest on a label before its first page appears. */
const PAGE_PREVIEW_DELAY_MS = 1000;

export type NotesViewProps = {
  /** Make this document the PDF on screen. */
  onOpenDocument: (document: PdfDocumentListItem) => void;
  /** The row is gone. The viewer resolves its path and closes the PDF when the file is gone. */
  onDocumentDeleted?: (document: PdfDocumentListItem) => void;
  /** Open this strip in the viewer. */
  onOpenStrip: (document: PdfDocumentListItem, strip: FocusableStrip) => void;
  /** Page-level status line, for backend errors and confirmations. */
  onStatus?: (message: string) => void;
  pendingEditId?: number | null;
  onPendingEditHandled?: () => void;
};

export function NotesView({
  onOpenDocument,
  onOpenStrip,
  onDocumentDeleted,
  onStatus,
  pendingEditId = null,
  onPendingEditHandled,
}: NotesViewProps) {
  const { data: allDocuments = [], isLoading, isError, error } = pdfDocumentApi.endpoints.listDocuments.useQuery();
  const [reorderDocuments] = pdfDocumentApi.endpoints.reorderDocuments.useMutation();
  const [renameDocument] = pdfDocumentApi.endpoints.renameDocument.useMutation();
  const [deleteDocument] = pdfDocumentApi.endpoints.deleteDocument.useMutation();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** The row whose menu is open, and where the pointer was. */
  const [menu, setMenu] = useState<{ document: PdfDocumentListItem; x: number; y: number } | null>(null);
  /** The row whose name has been replaced by the rename field. */
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  /** First-page preview for the label under the pointer, anchored where it rested. */
  const [pagePreview, setPagePreview] = useState<{ path: string; x: number; y: number } | null>(null);
  const pagePreviewHandle = useRef<DocumentPagePreviewHandle>(null);
  const pagePreviewTimer = useRef<number | undefined>(undefined);
  const pagePreviewPointer = useRef({ x: 0, y: 0 });

  // Every opened PDF. A document with no strips still belongs in this list;
  // the right pane says that it has none.
  const documents = allDocuments;

  // Keep a selection without overriding the user's: the first document opens
  // itself so the tab is never an empty right-hand pane.
  const selectedDocument =
    documents.find((document) => document.id === selectedId) ?? documents[0] ?? null;

  const errorMessage = isError ? (apiErrorMessage(error) ?? "Could not load documents.") : null;
  const activeDocument =
    activeId === null ? null : (documents.find((document) => `document-${document.id}` === activeId) ?? null);

  // The row is its own activator, so a press only becomes a drag once the
  // pointer has moved: below that distance it is a click, and the row selects.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_DISTANCE_PX } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorder = useCallback(
    async (documentIds: number[]) => {
      try {
        await reorderDocuments({ document_ids: documentIds }).unwrap();
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not reorder documents.");
      }
    },
    [onStatus, reorderDocuments],
  );

  const rename = useCallback(
    async (id: number, name: string) => {
      setSavingId(id);
      try {
        await renameDocument({ id, name }).unwrap();
        setRenamingId(null);
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not rename that document.");
      } finally {
        setSavingId(null);
      }
    },
    [onStatus, renameDocument],
  );

  const hidePagePreview = useCallback(() => {
    window.clearTimeout(pagePreviewTimer.current);
    setPagePreview(null);
  }, []);

  useEffect(() => () => window.clearTimeout(pagePreviewTimer.current), []);

  const remove = useCallback(
    async (document: PdfDocumentListItem) => {
      try {
        await deleteDocument(document.id).unwrap();
        onDocumentDeleted?.(document);
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not delete that document.");
      }
    },
    [deleteDocument, onDocumentDeleted, onStatus],
  );

  // A deleted document must not leave a field or a menu pointing at a row that
  // is gone.
  useEffect(() => {
    if (renamingId !== null && !documents.some((document) => document.id === renamingId)) {
      setRenamingId(null);
    }
    if (menu && !documents.some((document) => document.id === menu.document.id)) {
      setMenu(null);
    }
  }, [documents, menu, renamingId]);

  const openDocumentMenu = (event: ReactMouseEvent, document: PdfDocumentListItem) => {
    // The field keeps the native menu: copy and paste is what a text field's
    // right-click is for.
    if (event.target instanceof Element && event.target.closest("input, textarea")) return;
    event.preventDefault();
    event.stopPropagation();
    // The menu is for this row. Selection stays on the document the last click
    // chose, so the highlight and the strips beside it do not move.
    hidePagePreview();
    setMenu({ document, x: event.clientX, y: event.clientY });
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    // A menu pinned to the pointer is wrong the moment the list starts moving,
    // and so is a page floating beside a row that is now the drag image.
    setMenu(null);
    hidePagePreview();
  };

  const previewFor = (document: PdfDocumentListItem) => ({
    onMouseEnter: (event: ReactMouseEvent) => {
      pagePreviewPointer.current = { x: event.clientX, y: event.clientY };
      window.clearTimeout(pagePreviewTimer.current);
      const path = document.file_path;
      pagePreviewTimer.current = window.setTimeout(() => {
        const point = pagePreviewPointer.current;
        setPagePreview({ path, x: point.x, y: point.y });
      }, PAGE_PREVIEW_DELAY_MS);
    },
    onMouseMove: (event: ReactMouseEvent) => {
      pagePreviewPointer.current = { x: event.clientX, y: event.clientY };
      pagePreviewHandle.current?.place(event.clientX, event.clientY);
    },
    onMouseLeave: hidePagePreview,
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const activeDocumentId = documentIdFromDrag(active.data.current);
    const overDocumentId = documentIdFromDrag(over.data.current);
    if (activeDocumentId === null || overDocumentId === null) return;
    const next = planSubsetReorder(
      allDocuments.map((document) => document.id),
      documents.map((document) => document.id),
      activeDocumentId,
      overDocumentId,
    );
    if (next) void reorder(next);
  };

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
            <strong>Save note</strong>.
          </p>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={documents.map((document) => `document-${document.id}`)}
            strategy={verticalListSortingStrategy}
          >
            <ul
              className={`notes-doc-list${activeId ? " is-reordering" : ""}`}
              onScroll={hidePagePreview}
            >
              {documents.map((document) => {
                const active = document.id === selectedDocument?.id;
                const renaming = document.id === renamingId;
                const pathTitle = document.original_path ?? document.file_path;
                return (
                  <li key={document.id}>
                    <SortableItem id={`document-${document.id}`} data={{ type: "document", document }}>
                      {renaming ? (
                        // A button cannot hold an input and more buttons, so the
                        // row becomes a plain box for as long as the name is a field.
                        <div
                          className={`notes-doc is-renaming${active ? " is-active" : ""}`}
                          title={pathTitle}
                          onContextMenu={(event) => openDocumentMenu(event, document)}
                        >
                          <DocumentRename
                            name={document.name}
                            busy={savingId === document.id}
                            onSave={(name) => void rename(document.id, name)}
                            onCancel={() => setRenamingId(null)}
                          />
                          <DocumentMeta document={document} />
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={`notes-doc${active ? " is-active" : ""}`}
                          onClick={() => setSelectedId(document.id)}
                          onContextMenu={(event) => openDocumentMenu(event, document)}
                          aria-pressed={active}
                        >
                          <DocumentLabel
                            document={document}
                            {...previewFor(document)}
                            onDoubleClick={() => {
                              hidePagePreview();
                              onOpenDocument(document);
                            }}
                          />
                        </button>
                      )}
                    </SortableItem>
                  </li>
                );
              })}
            </ul>
          </SortableContext>

          {createPortal(
            <DragOverlay>
              {activeDocument ? (
                <div className="notes-drag-overlay">
                  <div className="notes-doc">
                    <DocumentLabel document={activeDocument} />
                  </div>
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )}
        </DndContext>
      </section>

      <section className="notes-strips" aria-label="Saved strips">
        <header className="notes-head">
          <span
            className="notes-head-title"
            title={selectedDocument ? selectedDocument.original_path ?? selectedDocument.file_path : undefined}
          >
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
            Click a folder's row to open or close it · drag a document, a folder or a strip to reorder it · click a strip
            to open it · double-click a document to open it · double-click a note to edit it · right-click a document to
            open, rename or delete it · right-click for more
          </p>
        )}
      </section>

      {pagePreview && (
        <DocumentPagePreview
          ref={pagePreviewHandle}
          filePath={pagePreview.path}
          x={pagePreview.x}
          y={pagePreview.y}
        />
      )}

      {menu && (
        <DocumentContextMenu
          x={menu.x}
          y={menu.y}
          name={menu.document.name}
          stripCount={menu.document._count?.focusable_strips ?? 0}
          onOpen={() => {
            const document = menu.document;
            setMenu(null);
            onOpenDocument(document);
          }}
          onRename={() => {
            setRenamingId(menu.document.id);
            setMenu(null);
          }}
          onDelete={() => {
            const document = menu.document;
            setMenu(null);
            void remove(document);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/** The document a drag is carrying, or null when the payload is something else. */
function documentIdFromDrag(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const record = data as { type?: unknown; document?: { id?: unknown } };
  return record.type === "document" && typeof record.document?.id === "number" ? record.document.id : null;
}

/** The name and the saved time, shared by the row and the drag preview. */
function DocumentLabel({
  document,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  onDoubleClick,
}: {
  document: PdfDocumentListItem;
  onMouseEnter?: (event: ReactMouseEvent) => void;
  onMouseMove?: (event: ReactMouseEvent) => void;
  onMouseLeave?: () => void;
  onDoubleClick?: () => void;
}) {
  return (
    <span
      className="notes-doc-label"
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onDoubleClick={onDoubleClick}
    >
      <span className="notes-doc-name">{document.name}</span>
      <DocumentMeta document={document} />
    </span>
  );
}

function DocumentMeta({ document }: { document: PdfDocumentListItem }) {
  return (
    <span className="notes-doc-meta">
      <span className="notes-doc-time">{formatSavedAt(document.created_at)}</span>
    </span>
  );
}

/**
 * The name, replaced: the field sits where the text was, and Save and Cancel
 * sit on the line under it. Nothing is written until Save (or Enter); Escape and Cancel put
 * the text back. A click away does neither, so a half-typed name is not lost
 * and is not sent by accident.
 */
function DocumentRename({
  name,
  busy,
  onSave,
  onCancel,
}: {
  name: string;
  busy: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const trimmed = draft.trim();
  const unchanged = trimmed === name;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || trimmed.length === 0 || unchanged) return;
    onSave(trimmed);
  };

  return (
    <form className="notes-doc-rename" onSubmit={submit}>
      <input
        className="notes-doc-rename-field"
        value={draft}
        autoFocus
        maxLength={512}
        aria-label="Document name"
        disabled={busy}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <span className="notes-doc-rename-actions">
        <button
          type="submit"
          className="notes-doc-rename-save"
          disabled={busy || trimmed.length === 0 || unchanged}
        >
          Save
        </button>
        <button type="button" className="notes-doc-rename-cancel" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </span>
    </form>
  );
}
