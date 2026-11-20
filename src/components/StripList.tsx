/**
 * The saved strips of one document.
 *
 * Owns everything about them: the list query, the remark mutation, the delete
 * mutation, the inline editor and the markdown popup. Nothing above it fetches a
 * strip or passes one down — a host only says *which* document is on screen and
 * what to do when the reader asks to see a strip in the viewer.
 *
 * A card is one click target and it opens the strip; double-clicking the note
 * text edits the remark in place; the context menu holds the markdown popup and
 * delete, so the destructive action stays behind a deliberate gesture.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { apiErrorMessage } from "../store/api/baseApi";
import { focusableStripApi } from "../store/api/focusableStripApi";
import { folderApi } from "../store/api/folderApi";
import { formatSavedAt, noteSummary } from "../notesText";
import type { FocusableStrip } from "../types/dto";
import { planStripDrop, type StripGroup } from "../stripOrder";
import {
  expandGroup,
  nextFolderAction,
  setAllFoldersCollapsed,
  toggleGroup,
} from "../folderCollapse";
import { StripFolderBoard } from "./StripFolderBoard";
import { StripThumbnail } from "./StripThumbnail";
import { StripContextMenu } from "./StripContextMenu";
import { NewFolderMenu } from "./NewFolderMenu";

// The markdown parser is not part of the viewer's bundle; it loads with the first
// note card and is shared by every card after that.
const MarkdownNote = lazy(() => import("./MarkdownNote"));
// Same for the full editor popup.
const MarkdownNoteDialog = lazy(() =>
  import("../markdown/MarkdownNoteDialog").then((module) => ({
    default: module.MarkdownNoteDialog,
  })),
);

export type StripListProps = {
  /** Which document's strips to show. The query key and nothing else. */
  pdfDocumentId: number;
  /** Its file, for the thumbnails and the popup's band. */
  filePath: string;
  documentName: string;
  /** Shown when this document has no strips at all. */
  emptyMessage: string;
  /**
   * Strip whose remark should open in the inline editor as soon as the list has
   * it. Used right after a strip is saved, so the new note starts in its field.
   */
  pendingEditId?: number | null;
  /** Called once the pending strip has been opened for editing. */
  onPendingEditHandled?: () => void;
  /** Ask the viewer to park this strip. */
  onOpenStrip: (strip: FocusableStrip) => void;
  /** Page-level status line, for "note saved" / backend errors. */
  onStatus?: (message: string) => void;
};

type MenuState = { x: number; y: number; strip: FocusableStrip };
type EditState = { id: number; draft: string };

export function StripList({
  pdfDocumentId,
  filePath,
  documentName,
  emptyMessage,
  pendingEditId = null,
  onPendingEditHandled,
  onOpenStrip,
  onStatus,
}: StripListProps) {
  const { data: folders = [], isLoading, isError, error } = folderApi.endpoints.listFolders.useQuery({
    pdf_document_id: pdfDocumentId,
  });
  // The strips in no folder are not part of the folder list: the board shows them
  // as its own section, and "Move to folder" can put a strip there.
  const { data: unfiled = [] } = focusableStripApi.endpoints.listStrips.useQuery({
    pdf_document_id: pdfDocumentId,
    unfiled: true,
  });
  const strips = [...folders.flatMap((folder) => folder.focusable_strips), ...unfiled];
  const [updateRemark] = focusableStripApi.endpoints.updateStripRemark.useMutation();
  const [removeStrip] = focusableStripApi.endpoints.deleteStrip.useMutation();
  const [createFolder] = folderApi.endpoints.createFolder.useMutation();
  const [renameFolder] = folderApi.endpoints.renameFolder.useMutation();
  const [deleteFolder] = folderApi.endpoints.deleteFolder.useMutation();
  const [reorderFolderList] = folderApi.endpoints.reorderFolders.useMutation();
  const [reorderStripGroups] = focusableStripApi.endpoints.reorderStrips.useMutation();
  /** Where the empty-space menu was asked for, or null when it is closed. */
  const [newFolderAt, setNewFolderAt] = useState<{ x: number; y: number } | null>(null);
  /**
   * Which groups are closed. Empty means every folder is open, so the one button
   * above the list starts out reading "Collapse all" — see `folderCollapse.ts`.
   */
  const [collapsed, setCollapsed] = useState<Set<number | null>>(() => new Set());
  const folderIds = useMemo(() => folders.map((folder) => folder.id), [folders]);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  /** The markdown popup's target, or null when it is closed. */
  const [noteTarget, setNoteTarget] = useState<FocusableStrip | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);

  const startEdit = useCallback((strip: FocusableStrip) => {
    setEdit({ id: strip.id, draft: strip.remark });
    setMenu(null);
  }, []);

  // A strip that was just saved comes back from the API with this id: open it so
  // the note can be typed straight away.
  useEffect(() => {
    if (pendingEditId == null) return;
    const strip = strips.find((candidate) => candidate.id === pendingEditId);
    if (!strip) return;
    startEdit(strip);
    onPendingEditHandled?.();
  }, [pendingEditId, strips, startEdit, onPendingEditHandled]);

  // Autofocus, caret at the end: the field is opened to be typed in.
  useEffect(() => {
    const field = fieldRef.current;
    if (!edit || !field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [edit?.id]);

  /** Write a remark; shared by the inline field and the popup. */
  const saveRemark = useCallback(
    async (strip: FocusableStrip, remark: string) => {
      if (remark === strip.remark) return null;
      try {
        await updateRemark({ id: strip.id, remark }).unwrap();
        onStatus?.(remark.trim() ? "Note saved." : "Note cleared.");
        return null;
      } catch (cause) {
        return apiErrorMessage(cause) ?? "Could not save that note.";
      }
    },
    [onStatus, updateRemark],
  );

  const commitEdit = useCallback(async () => {
    if (!edit) return;
    const strip = strips.find((candidate) => candidate.id === edit.id);
    const draft = edit.draft;
    setEdit(null);
    if (!strip) return;
    const failure = await saveRemark(strip, draft);
    if (failure) onStatus?.(failure);
  }, [edit, onStatus, saveRemark, strips]);

  const commitDialog = useCallback(
    async (remark: string) => {
      if (!noteTarget) return;
      setNoteSaving(true);
      setNoteError(null);
      const failure = await saveRemark(noteTarget, remark);
      setNoteSaving(false);
      if (failure) {
        setNoteError(failure);
        return;
      }
      setNoteTarget(null);
    },
    [noteTarget, saveRemark],
  );

  const remove = useCallback(
    async (strip: FocusableStrip) => {
      try {
        await removeStrip(strip.id).unwrap();
        onStatus?.(`Deleted the page ${strip.page_number} strip.`);
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not delete that strip.");
      }
    },
    [onStatus, removeStrip],
  );

  /** Make a folder from the empty-space menu, which has already taken its name. */
  const addFolder = useCallback(
    async (name: string) => {
      setNewFolderAt(null);
      try {
        await createFolder({ pdf_document_id: pdfDocumentId, name }).unwrap();
        onStatus?.(`Added the folder "${name}".`);
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not add that folder.");
      }
    },
    [createFolder, onStatus, pdfDocumentId],
  );

  /**
   * Right-click on the column's empty space.
   *
   * Cards and folder headers answer right-clicks themselves, so anything else in
   * the column — the gap between cards, the space below the last one, the empty
   * document — is where a new folder can be made.
   */
  const onEmptySpaceContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element && target.closest(".notes-card, .notes-folder-head")) return;
    event.preventDefault();
    setNewFolderAt({ x: event.clientX, y: event.clientY });
  }, []);

  const rename = useCallback(
    async (id: number, name: string) => {
      try {
        await renameFolder({ id, name }).unwrap();
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not rename that folder.");
      }
    },
    [onStatus, renameFolder],
  );

  const removeFolder = useCallback(
    async (id: number) => {
      // The folder's strips go with it, so the request has to say so: the
      // backend refuses to remove a folder that still holds strips otherwise.
      const folder = folders.find((candidate) => candidate.id === id);
      const stripCount = folder?.focusable_strips.length ?? 0;
      try {
        await deleteFolder({ id, with_strips: stripCount > 0 }).unwrap();
        onStatus?.(
          stripCount > 0
            ? `Deleted the folder "${folder?.name ?? id}" and its ${stripCount} strip${stripCount === 1 ? "" : "s"}.`
            : `Deleted the folder "${folder?.name ?? id}".`,
        );
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not delete that folder.");
      }
    },
    [deleteFolder, folders, onStatus],
  );

  /**
   * Move a strip to another folder, or out of every folder.
   *
   * It is the same membership request a drag sends, built by the same planner, so
   * the menu cannot leave the folder lists in a shape the drag could not.
   */
  /** Open or close one group, from its chevron or from a drop into it. */
  const toggleCollapsedGroup = useCallback((id: number | null) => {
    setCollapsed((current) => toggleGroup(current, id));
  }, []);

  const expandCollapsedGroup = useCallback((id: number | null) => {
    setCollapsed((current) => expandGroup(current, id));
  }, []);

  const toggleAllFolders = useCallback(() => {
    setCollapsed((current) =>
      setAllFoldersCollapsed(current, folderIds, nextFolderAction(folderIds, current) === "collapse"),
    );
  }, [folderIds]);

  const moveStrip = useCallback(
    async (strip: FocusableStrip, targetFolderId: number | null) => {
      setMenu(null);
      const groups = planStripDrop(
        [
          { id: null, strip_ids: unfiled.map((item) => item.id) },
          ...folders.map((folder) => ({
            id: folder.id,
            strip_ids: folder.focusable_strips.map((item) => item.id),
          })),
        ],
        strip.id,
        { type: "folder", id: targetFolderId },
      );
      // No groups means the strip is already there; the menu just closes.
      if (!groups) return;

      try {
        await reorderStripGroups({ pdf_document_id: pdfDocumentId, groups }).unwrap();
        // A strip dropped into a closed folder would look like it vanished.
        expandCollapsedGroup(targetFolderId);
        const target = folders.find((folder) => folder.id === targetFolderId);
        onStatus?.(
          target
            ? `Moved the page ${strip.page_number} strip to "${target.name}".`
            : `Moved the page ${strip.page_number} strip out of its folders.`,
        );
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not move that strip.");
      }
    },
    [expandCollapsedGroup, folders, unfiled, onStatus, pdfDocumentId, reorderStripGroups],
  );

  const reorderFolders = useCallback(
    async (folderIds: number[]) => {
      try {
        await reorderFolderList({ pdf_document_id: pdfDocumentId, folder_ids: folderIds }).unwrap();
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not reorder the folders.");
      }
    },
    [onStatus, pdfDocumentId, reorderFolderList],
  );

  const reorderStrips = useCallback(
    async (groups: StripGroup[]) => {
      try {
        await reorderStripGroups({ pdf_document_id: pdfDocumentId, groups }).unwrap();
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not reorder the strips.");
      }
    },
    [onStatus, pdfDocumentId, reorderStripGroups],
  );

  const errorMessage = isError ? (apiErrorMessage(error) ?? "Could not load the strips.") : null;

  const renderStrip = (strip: FocusableStrip) => {
    const editing = edit?.id === strip.id;
    // Plain text only for the tooltip and the "has a note" test; the card
    // itself renders the markdown.
    const summary = noteSummary(strip.remark);
    const hasNote = strip.remark.trim().length > 0;
    const label = summary || strip.text_excerpt || "";
    return (
      <div
        className={`notes-card${editing ? " is-editing" : ""}`}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY, strip });
        }}
      >
        <button
          type="button"
          className="notes-card-open"
          onClick={() => onOpenStrip(strip)}
          title={label || `Page ${strip.page_number}`}
        >
          {/* The snapshot leads, the note follows it: that is the order
                      the two are read in, and the strip is what the note is
                      about. */}
          <StripThumbnail path={filePath} band={strip} />
        </button>

        {editing ? (
          <div className="notes-card-editor">
            <textarea
              ref={fieldRef}
              className="notes-card-field"
              value={edit.draft}
              rows={3}
              placeholder="Markdown note for this strip…"
              onChange={(event) => setEdit({ id: strip.id, draft: event.target.value })}
              onKeyDown={(event) => {
                // Enter alone keeps making new lines; ⌘/Ctrl+Enter saves.
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void commitEdit();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEdit(null);
                }
              }}
            />
            <div className="notes-card-editor-actions">
              <button
                type="button"
                className="notes-card-save"
                onClick={() => void commitEdit()}
              >
                Save note
              </button>
              <button
                type="button"
                className="notes-card-cancel"
                onClick={() => setEdit(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <span
            className={`notes-card-note${hasNote ? "" : " is-muted"}`}
            // Double-click the text to edit it here; a single click on the
            // card still opens the strip.
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              startEdit(strip);
            }}
            title="Double-click to edit this note"
          >
            {hasNote ? (
              // The fallback is the flattened text: the card is never
              // empty while the parser loads.
              <Suspense fallback={summary}>
                <MarkdownNote markdown={strip.remark} />
              </Suspense>
            ) : (
              // No note: the strip's own text is a useful label, and
              // plain text is the honest way to show it.
              strip.text_excerpt || "Double-click to add a note"
            )}
          </span>
        )}

        {!editing && (
          <div className="notes-card-foot">
            <span className="notes-card-meta">
              Page {strip.page_number} · {formatSavedAt(strip.created_at)}
              {hasNote ? "" : " · no note"}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="notes-strip-body" onContextMenu={onEmptySpaceContextMenu}>
      {isLoading && folders.length === 0 && <p className="notes-message">Loading strips…</p>}
      {errorMessage && <p className="notes-message is-error">{errorMessage}</p>}
      {!isLoading && !errorMessage && folders.length === 0 && unfiled.length === 0 && (
        <p className="notes-message">{emptyMessage}</p>
      )}

      {folders.length > 0 && (
        <div className="notes-folder-tools">
          <span className="notes-folder-tools-count">
            {folders.length} folder{folders.length === 1 ? "" : "s"}
          </span>
          <button type="button" className="notes-folder-tools-toggle" onClick={toggleAllFolders}>
            {nextFolderAction(folderIds, collapsed) === "collapse" ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}

      {/* A document can have strips but no folders: every strip is in no folder. */}
      {(folders.length > 0 || unfiled.length > 0) && (
        <StripFolderBoard
          folders={folders}
          unfiled={unfiled}
          collapsed={collapsed}
          onToggleGroup={toggleCollapsedGroup}
          onExpandGroup={expandCollapsedGroup}
          onReorderFolders={(folderIds) => void reorderFolders(folderIds)}
          onReorderStrips={(groups) => void reorderStrips(groups)}
          onRenameFolder={(id, name) => void rename(id, name)}
          onDeleteFolder={(id) => void removeFolder(id)}
          renderStrip={renderStrip}
        />
      )}

      {menu && (
        <StripContextMenu
          x={menu.x}
          y={menu.y}
          currentFolderId={menu.strip.folder_id}
          folders={folders.map((folder) => ({ id: folder.id, name: folder.name }))}
          onMove={(folderId) => void moveStrip(menu.strip, folderId)}
          onClose={() => setMenu(null)}
          onEditMarkdown={() => {
            const strip = menu.strip;
            setMenu(null);
            setNoteError(null);
            setNoteTarget(strip);
          }}
          onDelete={() => {
            const strip = menu.strip;
            setMenu(null);
            void remove(strip);
          }}
        />
      )}

      {noteTarget && (
        <Suspense
          fallback={
            <div className="note-backdrop" aria-busy="true">
              <div className="note-loading">Loading the note editor…</div>
            </div>
          }
        >
          {createPortal(
            <MarkdownNoteDialog
              title={`Edit note · page ${noteTarget.page_number}`}
              subtitle={documentName}
              initialMarkdown={noteTarget.remark}
              stripPreview={{ path: filePath, band: noteTarget }}
              saving={noteSaving}
              error={noteError}
              onCancel={() => {
                if (noteSaving) return;
                setNoteTarget(null);
                setNoteError(null);
              }}
              onSave={(markdown) => void commitDialog(markdown)}
            />,
            document.body,
          )}
        </Suspense>
      )}

      {newFolderAt && (
        <NewFolderMenu
          x={newFolderAt.x}
          y={newFolderAt.y}
          onClose={() => setNewFolderAt(null)}
          onCreate={(name) => void addFolder(name)}
        />
      )}
    </div>
  );
}
