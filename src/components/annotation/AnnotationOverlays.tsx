/**
 * The two things a pin can put over the stage: the editor it is written in, and
 * the menu a right-click opens on it.
 *
 * They belong in one file because they are two states of the same pin — the menu
 * hands a pin to the editor (`onEdit`), and both are portalled, so they sit above
 * the stage at the pointer's own coordinates rather than inside the page they are
 * about. Each is null when there is nothing to show, so the stage's JSX says only
 * which one the viewer is in.
 */
import type { Annotation } from "../../types/dto";
import { AnnotationEditor } from "./AnnotationEditor";
import { AnnotationContextMenu } from "./AnnotationContextMenu";

/** The pin being written — a new one on bare paper, or an existing one retyped. */
export type AnnotationDraftState = {
  mode: "new" | "edit";
  /** The row being retyped; null for a pin that has no row yet. */
  id: number | null;
  page: number;
  point: { x: number; y: number };
  /** Where the editor opens, in viewport coordinates. */
  x: number;
  y: number;
  text: string;
};

export type AnnotationOverlaysProps = {
  draft: AnnotationDraftState | null;
  saving: boolean;
  error: string | null;
  onSaveDraft: (text: string) => void;
  onCancelDraft: () => void;
  /** A saved pin's delete, from the editor. Absent for a pin with no row yet. */
  onDeleteDraft?: () => void;
  menu: { annotation: Annotation; x: number; y: number } | null;
  onEdit: (annotation: Annotation, x: number, y: number) => void;
  onCopyReference: (id: number) => void;
  onDelete: (id: number) => void;
  onCloseMenu: () => void;
};

export function AnnotationOverlays({
  draft,
  saving,
  error,
  onSaveDraft,
  onCancelDraft,
  onDeleteDraft,
  menu,
  onEdit,
  onCopyReference,
  onDelete,
  onCloseMenu,
}: AnnotationOverlaysProps) {
  return (
    <>
      {/* The pin being written — a new one where the tool was used on bare
      paper, or an existing one being retyped. Portalled by the component
      itself, so it sits above the stage at the pointer's coordinates. */}
      {draft && (
        <AnnotationEditor
          // A fresh box per draft: its text is the text it starts with, and
          // one press on another pin must not inherit the last one's draft.
          key={
            draft.id === null
              ? `new-${draft.page}-${draft.point.x}-${draft.point.y}`
              : `edit-${draft.id}`
          }
          mode={draft.mode}
          x={draft.x}
          y={draft.y}
          page={draft.page}
          text={draft.text}
          saving={saving}
          error={error}
          onSave={(text) => onSaveDraft(text)}
          onCancel={() => onCancelDraft()}
          onDelete={onDeleteDraft}
        />
      )}

      {/* One pin's own menu: edit it, copy the reference a note can point at,
      or drop it. Opened by right-clicking the pin, whatever tool is armed. */}
      {menu && (
        <AnnotationContextMenu
          x={menu.x}
          y={menu.y}
          onEdit={() => onEdit(menu.annotation, menu.x, menu.y)}
          onCopyReference={() => onCopyReference(menu.annotation.id)}
          onDelete={() => onDelete(menu.annotation.id)}
          onClose={() => onCloseMenu()}
        />
      )}
    </>
  );
}
