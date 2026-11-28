/**
 * The Dashboard tab: every document the backend knows, and the strips of the one you
 * pick.
 *
 * Owns its own queries — the document list here, the strips inside `StripList` —
 * and its own selection. The only thing it does not own is what "open this strip
 * in the viewer" means, which is the page's job, so that comes in as one callback.
 *
 * The split between the two panes is draggable and remembered like the docked
 * columns' seams: the width lives in this component, and the app state keeps it
 * across launches (`notesViewSplit.ts` holds the numbers).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { FolderPlus, Tag as TagIcon, X } from "lucide-react";
import { appStateApi } from "../store/api/appStateApi";
import { apiErrorMessage } from "../store/api/baseApi";
import { pdfTagApi } from "../store/api/pdfTagApi";
import { documentIdForRenameShortcut } from "../documentRenameShortcut";
import { filterDocumentsByTag, pruneMissingTag } from "../documentTagFilter";
import { copiedDocumentTags, copyDocumentTags } from "../documentTagClipboard";
import { pdfDocumentApi } from "../store/api/pdfDocumentApi";
import { pdfDocumentFolderApi } from "../store/api/pdfDocumentFolderApi";
import { formatSavedAt } from "../notesText";
import {
  DEFAULT_NOTES_VIEW_DOCUMENTS,
  clampNotesViewDocumentsWidth,
  maxNotesViewDocumentsWidth,
} from "../notesViewSplit";
import type { AnnotationWithDocument, Note, NoteWithDocument, PdfDocumentListItem } from "../types/dto";
import { endDragOnBlur } from "../windowDrag";
import { DocumentFolderBoard } from "./DocumentFolderBoard";
import { DocumentContextMenu } from "./DocumentContextMenu";
import { DocumentTagsPopover } from "./DocumentTagsPopover";
import { TagFilterInput } from "./TagFilterInput";
import { TagManagerPopover } from "./TagManagerPopover";
import { DocumentPagePreview } from "./DocumentPagePreview";
import { DocumentThumbnail } from "./DocumentThumbnail";
import { StripList } from "./StripList";

/** How long the pointer must rest on a thumbnail before its preview appears.
 *
 * Short, because the preview is entered from that same sheet: a second read as a
 * wait for something that had not happened yet. Three hundred milliseconds is
 * still long enough that a pointer travelling across the rail does not open a box
 * on every row it passes.
 */
const PAGE_PREVIEW_DELAY_MS = 300;
/** Space between the thumbnail's right edge and the preview, so the two do not touch. */
const PAGE_PREVIEW_GAP_PX = 8;
/**
 * How long the preview waits to be entered after the pointer leaves its thumbnail.
 *
 * The box opens just clear of the pointer, so moving onto it means leaving the
 * icon first. This is the time that walk is given; without it the preview would
 * close before it could be reached, and it could never be turned.
 */
const PAGE_PREVIEW_HIDE_DELAY_MS = 260;

export type DashboardViewProps = {
  /** Make this document the PDF on screen. */
  onOpenDocument: (document: PdfDocumentListItem) => void;
  /**
   * Open this document in a viewer window of its own, beside this one.
   *
   * Left out where there is no second window to open (the plain web build), so
   * the menu item can say why instead of doing nothing.
   */
  onOpenDocumentInNewWindow?: (document: PdfDocumentListItem) => void;
  /** The row is gone. The viewer resolves its path and closes the PDF when the file is gone. */
  onDocumentDeleted?: (document: PdfDocumentListItem) => void;
  /** Open this strip in the viewer. */
  onOpenStrip: (document: PdfDocumentListItem, strip: Note) => void;
  /**
   * A `[note:<id>]` reference was clicked inside a note: show that note.
   *
   * It is the same request whichever view it comes from — open the note in a
   * "Notes of this PDF" window for its document, with the card marked — so this
   * tab only passes it on, the way the cards' own list does.
   */
  onRevealNote?: (strip: NoteWithDocument) => void;
  /** A `[annotation:<id>]` reference was clicked: show that pin's PDF. */
  onRevealAnnotation?: (annotation: AnnotationWithDocument) => void;
  /** Page-level status line, for backend errors and confirmations. */
  onStatus?: (message: string) => void;
  pendingEditId?: number | null;
  onPendingEditHandled?: () => void;
};

export function DashboardView({
  onOpenDocument,
  onOpenDocumentInNewWindow,
  onOpenStrip,
  onRevealNote,
  onRevealAnnotation,
  onDocumentDeleted,
  onStatus,
  pendingEditId = null,
  onPendingEditHandled,
}: DashboardViewProps) {
  const { data: allDocuments = [], isLoading, isError, error } = pdfDocumentApi.endpoints.listDocuments.useQuery();
  const { data: documentFolders = [] } = pdfDocumentFolderApi.endpoints.listPdfDocumentFolders.useQuery();
  const [reorderDocuments] = pdfDocumentApi.endpoints.reorderDocuments.useMutation();
  const [renameDocument] = pdfDocumentApi.endpoints.renameDocument.useMutation();
  const [deleteDocument] = pdfDocumentApi.endpoints.deleteDocument.useMutation();
  const [copyPdfTags] = pdfDocumentApi.endpoints.copyPdfTags.useMutation();
  const [createFolder] = pdfDocumentFolderApi.endpoints.createPdfDocumentFolder.useMutation();
  const [renameFolder] = pdfDocumentFolderApi.endpoints.renamePdfDocumentFolder.useMutation();
  const [deleteFolder] = pdfDocumentFolderApi.endpoints.deletePdfDocumentFolder.useMutation();
  const [reorderFolders] = pdfDocumentFolderApi.endpoints.reorderPdfDocumentFolders.useMutation();
  const [assignDocuments] = pdfDocumentFolderApi.endpoints.assignPdfDocumentsToFolder.useMutation();
  const [removeDocuments] = pdfDocumentFolderApi.endpoints.removePdfDocumentsFromFolder.useMutation();
  const [reorderMembers] = pdfDocumentFolderApi.endpoints.reorderPdfDocumentFolderMembers.useMutation();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  /** The row whose menu is open, and where the pointer was. */
  const [menu, setMenu] = useState<{ document: PdfDocumentListItem; x: number; y: number } | null>(null);
  /** The row whose name has been replaced by the rename field. */
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  /** The tag manager is anchored to its header button; null when closed. */
  const [tagManagerAnchor, setTagManagerAnchor] = useState<HTMLElement | null>(null);
  /** The tag the rail is narrowed by; null means no filter. */
  const [filterTagId, setFilterTagId] = useState<number | null>(null);
  /** Groups the reader has opened. Empty means every folder, and Ungrouped, starts closed. */
  const [openFolders, setOpenFolders] = useState<Set<number | "ungrouped">>(new Set());
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  /** The row whose tag assignment is open, and where the menu was. */
  const [assignment, setAssignment] = useState<{
    document: PdfDocumentListItem;
    x: number;
    y: number;
  } | null>(null);
  const tagManagerButtonRef = useRef<HTMLButtonElement>(null);
  /**
   * The pages floating beside the pointer that asked for them.
   *
   * Whether it stays open is decided by *where the pointer is*, not by the
   * enter/leave pairs the DOM reports. WebKit fires a leave with no related target
   * when the content under a still pointer is replaced — a page painted into the
   * canvas, say — and a preview that closed on its own paint would make its page
   * buttons useless: every press would be the last thing it ever did.
   */
  const [pagePreview, setPagePreview] = useState<{ path: string; x: number; y: number } | null>(null);
  const pagePreviewTimer = useRef<number | undefined>(undefined);
  const pagePreviewHideTimer = useRef<number | undefined>(undefined);
  /** The row's own first-page preview: the sheet the box is opened from. */
  const pagePreviewIcon = useRef<HTMLElement | null>(null);
  /** The last place the pointer was seen, in viewport pixels. */
  const pagePreviewPointer = useRef({ x: 0, y: 0 });
  const pagePreviewOpen = useRef(false);
  const [documentsWidth, setDocumentsWidth] = useState(DEFAULT_NOTES_VIEW_DOCUMENTS);
  const { data: appState } = appStateApi.endpoints.getAppState.useQuery();
  const [updateAppState] = appStateApi.endpoints.updateAppState.useMutation();
  /** The tab the two panes divide: the ceiling is measured from it. */
  const notesRef = useRef<HTMLDivElement>(null);
  const documentsRef = useRef<HTMLElement>(null);
  /**
   * The documents column took the last pointer press.
   *
   * A click on a folder heading or the column's empty space leaves focus on the
   * page, not on a row, and F2 or Enter should still rename the highlighted
   * document. A press in the strips pane clears it, so Enter there stays a note.
   */
  const documentsColumnActive = useRef(false);
  /** A width is remembered, so the stored one is applied once — see the effect below. */
  const documentsWidthLoaded = useRef(false);

  // Every opened PDF. A document with no strips still belongs in this list;
  // the right pane says that it has none.
  const documents = allDocuments;

  // The catalogue is needed for the field's matches and the chip's label; the
  // rows themselves carry ids only.
  const { data: allTags = [] } = pdfTagApi.endpoints.listPdfTags.useQuery();
  const filtering = filterTagId !== null;
  const visibleDocuments = useMemo(
    () => filterDocumentsByTag(documents, filterTagId),
    [documents, filterTagId],
  );

  // A tag deleted in the manager (or another window) must leave the filter, or
  // the rail would show nothing and look broken.
  useEffect(() => {
    setFilterTagId((id) => pruneMissingTag(id, allTags));
  }, [allTags]);

  // Keep a selection without overriding the user's: the first document opens
  // itself so the tab is never an empty right-hand pane.
  const selectedDocument =
    documents.find((document) => document.id === selectedId) ?? documents[0] ?? null;

  const errorMessage = isError ? (apiErrorMessage(error) ?? "Could not load documents.") : null;
  // The chip that names the filter. A tag that is gone has no chip and, as the
  // effect above says, no filter either.
  const filterTag = filterTagId === null ? null : (allTags.find((tag) => tag.id === filterTagId) ?? null);

  const documentsById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents],
  );
  const filedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const folder of documentFolders) {
      for (const id of folder.pdf_document_ids) ids.add(id);
    }
    return ids;
  }, [documentFolders]);
  const folderSections = useMemo(
    () => documentFolders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      documents: folder.pdf_document_ids.flatMap((id) => {
        const document = documentsById.get(id);
        if (!document) return [];
        return filterDocumentsByTag([document], filterTagId);
      }),
    })),
    [documentFolders, documentsById, filterTagId],
  );
  const ungroupedDocuments = useMemo(
    () => filterDocumentsByTag(
      documents.filter((document) => !filedIds.has(document.id)),
      filterTagId,
    ),
    [documents, filedIds, filterTagId],
  );

  // The remembered split, read once. A later invalidation must not fight a drag
  // that is already under way, so the first answer is the only one applied.
  useEffect(() => {
    if (documentsWidthLoaded.current || !appState) return;
    documentsWidthLoaded.current = true;
    const stored = appState.notes_documents_width;
    if (stored == null || stored <= 0) return;
    setDocumentsWidth(
      clampNotesViewDocumentsWidth(
        stored,
        maxNotesViewDocumentsWidth(notesRef.current?.getBoundingClientRect().width ?? 0),
      ),
    );
  }, [appState]);

  // A width is remembered, the window is not: a rail dragged wide on a large
  // screen would leave the notes a sliver on a small one, so the ceiling is
  // re-applied whenever the tab changes size. A width that already fits is left
  // untouched.
  useEffect(() => {
    const tab = notesRef.current;
    if (!tab || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const max = maxNotesViewDocumentsWidth(tab.getBoundingClientRect().width);
      setDocumentsWidth((width) => (width > max ? max : width));
    });
    observer.observe(tab);
    return () => observer.disconnect();
  }, []);

  /**
   * Drag the seam between the two panes. The rail takes room from the notes and
   * gives it back; unlike a docked column it never closes, because it is the only
   * way to pick a document. The width lives in state while dragging (so the notes
   * reflow live) and is written once, on release.
   */
  const onDocumentsResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rail = documentsRef.current;
    const tab = notesRef.current;
    if (!rail || !tab) return;
    event.preventDefault();
    const handle = event.currentTarget;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // The pointer can already be gone; the listeners below still work.
    }
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = rail.getBoundingClientRect().width;
    // Measured once, at the press: the tab cannot change size mid-drag.
    const maxWidth = maxNotesViewDocumentsWidth(tab.getBoundingClientRect().width);
    let width = startWidth;

    const onMove = (move: PointerEvent) => {
      // Dragging right widens the rail: the seam follows the pointer, and the
      // notes give up what it takes.
      width = clampNotesViewDocumentsWidth(startWidth + (move.clientX - startX), maxWidth);
      setDocumentsWidth(width);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      stopOnBlur();
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      if (Math.abs(width - startWidth) < 1) return;
      // Fire and forget: forgetting the width only means the next launch starts
      // at the default.
      void updateAppState({ notes_documents_width: Math.round(width) });
    };
    // Interrupted, the rail settles where the drag left it: the width is already
    // that on screen, and `onUp` is what writes it down.
    const stopOnBlur = endDragOnBlur(onUp);
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

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

  const runFolder = useCallback(
    async (action: () => Promise<unknown>, fallback: string): Promise<boolean> => {
      try {
        await action();
        return true;
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? fallback);
        return false;
      }
    },
    [onStatus],
  );

  const cancelPreviewHide = useCallback(() => {
    window.clearTimeout(pagePreviewHideTimer.current);
    pagePreviewHideTimer.current = undefined;
  }, []);

  /** Close it now: the pointer is elsewhere, or the list moved under it. */
  const hidePagePreview = useCallback(() => {
    window.clearTimeout(pagePreviewTimer.current);
    cancelPreviewHide();
    pagePreviewIcon.current = null;
    setPagePreview(null);
  }, [cancelPreviewHide]);

  /** Is the pointer inside `element`, as of the last place it was seen? */
  const pointerOver = useCallback((element: Element | null): boolean => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const { x, y } = pagePreviewPointer.current;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }, []);

  /** Is the pointer holding the preview open: on the sheet it came from, or on the box? */
  const pointerHoldsPreview = useCallback(
    () =>
      pointerOver(pagePreviewIcon.current) ||
      pointerOver(document.querySelector(".notes-doc-preview")),
    [pointerOver],
  );

  /** Close it shortly, unless the pointer is on the sheet or has reached the box. */
  const releasePagePreview = useCallback(() => {
    cancelPreviewHide();
    pagePreviewHideTimer.current = window.setTimeout(() => {
      if (pointerHoldsPreview()) return;
      hidePagePreview();
    }, PAGE_PREVIEW_HIDE_DELAY_MS);
  }, [cancelPreviewHide, hidePagePreview, pointerHoldsPreview]);

  // Where the pointer is decides whether the preview lives, so the whole window is
  // watched while one can be open. Nothing here is trusted to a mouseenter or a
  // mouseleave: only the coordinates, against the two boxes that hold it.
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      pagePreviewPointer.current = { x: event.clientX, y: event.clientY };
      if (pointerHoldsPreview()) {
        cancelPreviewHide();
        return;
      }
      // Off both: a preview still waiting to open is abandoned, and one already
      // open starts closing.
      window.clearTimeout(pagePreviewTimer.current);
      if (pagePreviewOpen.current) releasePagePreview();
    };
    // The pointer left the window altogether, and there will be no move to say so.
    const onLeaveWindow = () => {
      if (pagePreviewOpen.current) releasePagePreview();
    };
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mousedown", onMove, true);
    document.addEventListener("mouseleave", onLeaveWindow);
    return () => {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mousedown", onMove, true);
      document.removeEventListener("mouseleave", onLeaveWindow);
    };
  }, [cancelPreviewHide, pointerHoldsPreview, releasePagePreview]);

  pagePreviewOpen.current = pagePreview !== null;

  // Escape puts the preview away while the pointer is still on it. The key is
  // taken here, in front of the dashboard's other layers, so one press closes
  // the popover and leaves the event log where it was. A field keeps the key:
  // Escape there still cancels the name or the filter.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !pagePreviewOpen.current) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      event.stopPropagation();
      hidePagePreview();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [hidePagePreview]);

  useEffect(
    () => () => {
      window.clearTimeout(pagePreviewTimer.current);
      window.clearTimeout(pagePreviewHideTimer.current);
    },
    [],
  );

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

  /**
   * Take this row as the source a paste will copy from.
   *
   * Nothing is written: the document is remembered in `documentTagClipboard.ts`,
   * which outlives this menu and this tab, so the next right-click anywhere in
   * the rail can make its document carry this one's tags.
   */
  const copyTags = useCallback(
    (document: PdfDocumentListItem) => {
      copyDocumentTags({ documentId: document.id, documentName: document.name });
      onStatus?.(`Copied ${tagCountLabel(document.tags.length)} from “${document.name}”.`);
    },
    [onStatus],
  );

  /**
   * Replace this row's tags with the copied document's.
   *
   * One command, not a diff of two requests: `CopyPdfTagsCommand` reads the
   * source and writes both halves of the overwrite in one transaction, so a
   * failed paste leaves the target exactly as it was instead of half-emptied.
   * The copy is a document rather than a frozen set of ids, so a tag added to the
   * source after the copy is part of what lands here.
   */
  const pasteTags = useCallback(
    async (document: PdfDocumentListItem) => {
      const copied = copiedDocumentTags();
      if (!copied) return;
      try {
        await copyPdfTags({ id: document.id, from_document_id: copied.documentId }).unwrap();
        onStatus?.(`Pasted the tags of “${copied.documentName}” onto “${document.name}”.`);
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not paste the tags.");
      }
    },
    [copyPdfTags, onStatus],
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
    if (assignment && !documents.some((document) => document.id === assignment.document.id)) {
      setAssignment(null);
    }
  }, [assignment, documents, menu, renamingId]);

  // F2 and Enter open the same rename field as the row's menu. The key is the
  // column's: a row that has focus, or a press in the column that left focus on
  // the page. A text field, a folder control, the header buttons and the strips
  // pane keep Enter for themselves.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      documentsColumnActive.current =
        target instanceof Node && (documentsRef.current?.contains(target) ?? false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const id = renameTargetFromKey(event, {
        column: documentsRef.current,
        columnActive: documentsColumnActive.current,
        blocked: menu !== null || assignment !== null || tagManagerAnchor !== null,
        selectedId: selectedDocument?.id ?? null,
        visibleIds: new Set(visibleDocuments.map((document) => document.id)),
      });
      if (id === null) return;
      event.preventDefault();
      event.stopPropagation();
      setSelectedId(id);
      setRenamingId(id);
      setOpenFolders((current) => {
        const folder = documentFolders.find((entry) => entry.pdf_document_ids.includes(id));
        const key = folder ? folder.id : "ungrouped";
        if (current.has(key)) return current;
        const next = new Set(current);
        next.add(key);
        return next;
      });
      hidePagePreview();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [
    assignment,
    documentFolders,
    hidePagePreview,
    menu,
    selectedDocument,
    tagManagerAnchor,
    visibleDocuments,
  ]);

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

  /**
   * Resting on the first-page preview in a row offers that document's pages after
   * a moment, starting at that thumbnail.
   *
   * Only that little sheet: hovering the name or the date stays a plain
   * highlight, and a large preview opening whenever the pointer crossed a name on
   * its way to the strips would be noise. A box already open for this document
   * keeps its place rather than jumping to a pointer that came back to it.
   */
  const previewFor = (document: PdfDocumentListItem) => ({
    onMouseEnter: (event: ReactMouseEvent) => {
      pagePreviewIcon.current = event.currentTarget as HTMLElement;
      pagePreviewPointer.current = { x: event.clientX, y: event.clientY };
      cancelPreviewHide();
      // Another document's pages are the wrong pages to still be showing: close
      // them now rather than leave them up for the delay the new one takes.
      setPagePreview((current) =>
        current && current.path !== document.file_path ? null : current,
      );
      window.clearTimeout(pagePreviewTimer.current);
      pagePreviewTimer.current = window.setTimeout(() => {
        const icon = pagePreviewIcon.current?.getBoundingClientRect();
        const { x, y } = icon
          ? { x: icon.right + PAGE_PREVIEW_GAP_PX, y: icon.top }
          : pagePreviewPointer.current;
        setPagePreview((current) =>
          current && current.path === document.file_path ? current : { path: document.file_path, x, y },
        );
      }, PAGE_PREVIEW_DELAY_MS);
    },
  });

  return (
    <div className="notes" ref={notesRef}>
      <section
        className="notes-documents"
        aria-label="Documents"
        ref={documentsRef}
        // The width is the tab's own state, clamped by `notesViewSplit.ts` when it
        // is dragged, restored or re-fitted to the window.
        style={{ width: documentsWidth }}
      >
        {/* Right edge, so dragging towards the notes widens the rail. The handle is
            the rail's own border (see `.notes-documents-resizer`). */}
        <div
          className="notes-documents-resizer"
          onPointerDown={onDocumentsResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the documents rail"
          title="Drag to resize"
        />

        <header className="notes-head">
          <span className="notes-head-title">Documents</span>
          <span className="notes-head-actions">
            <button
              type="button"
              className="ghost notes-head-button"
              title="New document folder"
              aria-label="New document folder"
              onClick={() => setCreatingFolder(true)}
            >
              <FolderPlus size={16} aria-hidden />
            </button>
            <button
              ref={tagManagerButtonRef}
              type="button"
              className="ghost notes-head-button"
              title="Manage tags and tag folders"
              aria-label="Manage tags"
              onClick={() => setTagManagerAnchor((current) => (current ? null : tagManagerButtonRef.current))}
            >
              <TagIcon size={16} aria-hidden />
            </button>
            {/* The filter itself: a field you type a tag into, the way the
                reference project's `/tags` search works. */}
            <TagFilterInput tags={allTags} disabled={allTags.length === 0} onPick={setFilterTagId} />
          </span>
        </header>

        {filterTag && (
          <div className="notes-tag-filter" aria-label="Active tag filter">
            <button
              type="button"
              className="tag-chip is-filter"
              onClick={() => setFilterTagId(null)}
              title={`Stop filtering by ${filterTag.name}`}
            >
              {filterTag.name}
              <X size={11} aria-hidden />
            </button>
            <button type="button" className="notes-tag-clear" onClick={() => setFilterTagId(null)}>
              Clear
            </button>
          </div>
        )}

        {creatingFolder && (
          <form
            className="notes-tag-filter"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              const field = new FormData(event.currentTarget as HTMLFormElement).get("name");
              const name = typeof field === "string" ? field.trim() : "";
              if (!name) return;
              void runFolder(
                () => createFolder({ name }).unwrap(),
                "Could not create that folder.",
              ).then((created) => {
                if (created) setCreatingFolder(false);
              });
            }}
          >
            <div className="notes-tag-search">
              <input
                name="name"
                className="notes-tag-search-field"
                aria-label="Folder name"
                placeholder="Folder name"
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Escape") setCreatingFolder(false);
                }}
              />
            </div>
          </form>
        )}

        {isLoading && documents.length === 0 && <p className="notes-message">Loading…</p>}
        {errorMessage && <p className="notes-message is-error">{errorMessage}</p>}
        {!isLoading && !errorMessage && documents.length === 0 && (
          <p className="notes-message">
            No saved strips yet. Park a strip in the PDF tab, right-click it and choose{" "}
            <strong>Save note</strong>.
          </p>
        )}
        {!isLoading && !errorMessage && documents.length > 0 && visibleDocuments.length === 0 && (
          <p className="notes-message">No document carries this tag.</p>
        )}

        {(visibleDocuments.length > 0 || documentFolders.length > 0) && (
          <div className="notes-doc-scroll" onScroll={hidePagePreview}>
            <DocumentFolderBoard
              folders={folderSections}
              ungrouped={ungroupedDocuments}
              allDocumentIds={documents.map((document) => document.id)}
              filtering={filtering}
              open={openFolders}
              renamingFolderId={renamingFolderId}
              onToggle={(id) => {
                setOpenFolders((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
              }}
              onExpand={(id) => {
                setOpenFolders((current) => {
                  if (current.has(id)) return current;
                  const next = new Set(current);
                  next.add(id);
                  return next;
                });
              }}
              onReorderFolders={(ids) => {
                void runFolder(
                  () => reorderFolders({ pdf_document_folder_ids: ids }).unwrap(),
                  "Could not reorder folders.",
                );
              }}
              onReorderMembers={(folderId, ids) => {
                void runFolder(
                  () => reorderMembers({ id: folderId, pdf_document_ids: ids }).unwrap(),
                  "Could not reorder documents.",
                );
              }}
              onAssign={(folderId, documentId, index) => {
                void runFolder(
                  () => assignDocuments({ id: folderId, pdf_document_ids: [documentId], index }).unwrap(),
                  "Could not file that document.",
                );
              }}
              onRemove={(folderId, documentId) => {
                void runFolder(
                  () => removeDocuments({ id: folderId, pdf_document_ids: [documentId] }).unwrap(),
                  "Could not take that document out of the folder.",
                );
              }}
              onReorderDocuments={(ids) => void reorder(ids)}
              onBeginRename={(id) => setRenamingFolderId(id)}
              onCommitRename={(id, name) => {
                void runFolder(
                  () => renameFolder({ id, name }).unwrap(),
                  "Could not rename that folder.",
                ).then((renamed) => {
                  if (renamed) setRenamingFolderId(null);
                });
              }}
              onCancelRename={() => setRenamingFolderId(null)}
              onDeleteFolder={(id) => {
                void runFolder(
                  () => deleteFolder(id).unwrap(),
                  "Could not delete that folder.",
                );
              }}
              renderDocument={(document) => {
                const active = document.id === selectedDocument?.id;
                const renaming = document.id === renamingId;
                const pathTitle = document.original_path ?? document.file_path;
                if (renaming) {
                  return (
                    <div
                      className={`notes-doc is-renaming${active ? " is-active" : ""}`}
                      data-document-id={document.id}
                      title={pathTitle}
                      onContextMenu={(event) => openDocumentMenu(event, document)}
                    >
                      <DocumentThumbnail filePath={document.file_path} />
                      <div className="notes-doc-label">
                        <DocumentRename
                          name={document.name}
                          busy={savingId === document.id}
                          onSave={(name) => void rename(document.id, name)}
                          onCancel={() => setRenamingId(null)}
                        />
                        <DocumentMeta document={document} />
                      </div>
                    </div>
                  );
                }
                return (
                  <button
                    type="button"
                    className={`notes-doc${active ? " is-active" : ""}`}
                    data-document-id={document.id}
                    onClick={() => setSelectedId(document.id)}
                    onContextMenu={(event) => openDocumentMenu(event, document)}
                    aria-pressed={active}
                    onDoubleClick={() => {
                      hidePagePreview();
                      onOpenDocument(document);
                    }}
                  >
                    <DocumentThumbnail filePath={document.file_path} {...previewFor(document)} />
                    <DocumentLabel document={document} />
                  </button>
                );
              }}
            />
          </div>
        )}
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
            onRevealNote={onRevealNote}
            onRevealAnnotation={onRevealAnnotation}
            onStatus={onStatus}
            pendingEditId={pendingEditId}
            onPendingEditHandled={onPendingEditHandled}
          />
        ) : (
          <p className="notes-message">Pick a document to see its notes.</p>
        )}
      </section>

      {pagePreview && (
        <DocumentPagePreview
          filePath={pagePreview.path}
          x={pagePreview.x}
          y={pagePreview.y}
        />
      )}

      {tagManagerAnchor && (
        <TagManagerPopover anchor={{ element: tagManagerAnchor }} onClose={() => setTagManagerAnchor(null)} />
      )}

      {assignment && (
        <DocumentTagsPopover
          document={assignment.document}
          anchor={{ x: assignment.x, y: assignment.y }}
          onClose={() => setAssignment(null)}
        />
      )}

      {menu && (
        <DocumentContextMenu
          x={menu.x}
          y={menu.y}
          name={menu.document.name}
          stripCount={menu.document._count?.notes ?? 0}
          onOpen={() => {
            const document = menu.document;
            setMenu(null);
            onOpenDocument(document);
          }}
          onOpenInNewWindow={
            onOpenDocumentInNewWindow
              ? () => {
                  const document = menu.document;
                  setMenu(null);
                  onOpenDocumentInNewWindow(document);
                }
              : undefined
          }
          onRename={() => {
            setRenamingId(menu.document.id);
            setMenu(null);
          }}
          onTags={() => {
            setAssignment({ document: menu.document, x: menu.x, y: menu.y });
            setMenu(null);
          }}
          tagCount={menu.document.tags.length}
          // Read when the menu opens, so the item names the copy that is waiting
          // for it — or says there is none.
          pasteSource={copiedDocumentTags()?.documentName ?? null}
          onCopyTags={() => {
            const document = menu.document;
            setMenu(null);
            copyTags(document);
          }}
          onPasteTags={() => {
            const document = menu.document;
            setMenu(null);
            void pasteTags(document);
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

/**
 * The document F2 or Enter should rename, read off the key's target.
 *
 * The row carries `data-document-id`. Focus can also sit on the sortable wrapper
 * around that row, which is why the id is read from a child when the key did not
 * land on the row itself.
 */
function renameTargetFromKey(
  event: KeyboardEvent,
  scope: {
    column: HTMLElement | null;
    columnActive: boolean;
    blocked: boolean;
    selectedId: number | null;
    visibleIds: ReadonlySet<number>;
  },
): number | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const marked = readDocumentId(target.closest<HTMLElement>("[data-document-id]"));
  const nested = readDocumentId(
    target.closest(".notes-sortable-row")?.querySelector<HTMLElement>("[data-document-id]"),
  );
  const control = target.closest("button, a");
  return documentIdForRenameShortcut({
    key: event.key,
    repeat: event.repeat,
    composing: event.isComposing,
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    inColumn: scope.column?.contains(target) ?? false,
    focusOnPage: target === document.body || target === document.documentElement,
    columnActive: scope.columnActive,
    blocked: scope.blocked,
    foreignControl: control !== null && !control.classList.contains("notes-doc"),
    editing: target.closest("input, textarea, select, [contenteditable='true']") !== null,
    rowId: marked ?? nested,
    selectedId: scope.selectedId,
    isVisible: (id) => scope.visibleIds.has(id),
  });
}

function readDocumentId(element: HTMLElement | null | undefined): number | null {
  if (!element) return null;
  const id = Number(element.dataset.documentId);
  return Number.isInteger(id) ? id : null;
}

/** "1 tag" / "3 tags", for the status line a copy or a paste reports. */
function tagCountLabel(count: number): string {
  return `${count} ${count === 1 ? "tag" : "tags"}`;
}

/** The name and the saved time, shared by the row and the drag preview. */
function DocumentLabel({ document }: { document: PdfDocumentListItem }) {
  return (
    <span className="notes-doc-label">
      <span className="notes-doc-name">{document.name}</span>
      <DocumentTags tags={document.tags} />
      <DocumentMeta document={document} />
    </span>
  );
}

/** Up to three tags as chips, with the remainder counted. */
function DocumentTags({ tags }: { tags: PdfDocumentListItem["tags"] }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, 3);
  const hidden = tags.length - shown.length;
  return (
    <span className="notes-doc-tags">
      {shown.map((tag) => (
        <span key={tag.id} className="tag-chip" title={tag.name}>
          {tag.name}
        </span>
      ))}
      {hidden > 0 && (
        <span className="tag-chip is-more" title={tags.slice(3).map((tag) => tag.name).join(", ")}>
          +{hidden}
        </span>
      )}
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
