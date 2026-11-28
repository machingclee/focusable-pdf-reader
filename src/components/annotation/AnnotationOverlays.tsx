/**
 * The two things a pin can put over the stage: the editor a **new** pin is written
 * in, and the menu a right-click opens on one.
 *
 * They belong in one file because they are two states of the same pin — the menu
 * opens an existing pin's *writing* in the markdown popup (`onEditWithPreview`), and
 * both are portalled, so they sit above the stage at the pointer's own coordinates
 * rather than inside the page they are about. Each is null when there is nothing to
 * show, so the stage's JSX says only which one the viewer is in.
 *
 * Only a pin that does not exist yet is written *here*, in a box at the pointer: it
 * has no place of its own to write in. An existing pin's writing is changed in one
 * of two places, neither of which is in this file: in place, by an editor the page
 * draws over it (`PageAnnotation` and `AnnotationInlineEditor`, opened by a
 * double-press), or in the popup the menu's **Edit with preview** raises
 * (`AnnotationMarkdownDialog`, which the viewer renders because it is a dialog and
 * not an overlay of the stage). So an `edit` draft reaching this file renders
 * nothing at all — the page has it.
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
  /**
   * Where the editor opens, in viewport coordinates.
   *
   * Only a new pin's box uses these: an existing pin's editor is drawn at the
   * annotation's own corner on the page, which is why an edit's coordinates are only
   * remembered for the report a save makes.
   */
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
  /**
   * The open menu: the row it was opened on, where the press fell, and the type size
   * the row holds *now*.
   *
   * The size is read from the live row rather than the row the menu was opened on:
   * taking the writing up or down keeps the menu open — the reader presses it more
   * than once — and the label has to move with the writing.
   */
  menu: { annotation: Annotation; x: number; y: number; fontPt: number } | null;
  /** Draw the open menu's pin at this size while the track is dragged. */
  onFontPreview: (annotation: Annotation, fontPt: number) => void;
  /** Take the open menu's pin to this type size, in PDF points. */
  onFontSize: (annotation: Annotation, fontPt: number) => void;
  /**
   * Open this pin's writing in the markdown-and-preview popup.
   *
   * Only the row travels: the popup is a dialog of the window's, not a box at the
   * press, so where the right-click fell changes nothing about it.
   */
  onEditWithPreview: (annotation: Annotation) => void;
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
  menu,
  onFontPreview,
  onFontSize,
  onEditWithPreview,
  onCopyReference,
  onDelete,
  onCloseMenu,
}: AnnotationOverlaysProps) {
  return (
    <>
      {/* A new pin's box — the one being written where the tool was used on bare
      paper. An existing pin's text is edited on the page itself, or in the
      markdown popup its menu raises, so an edit draft draws nothing here. */}
      {draft?.mode === "new" && (
        <AnnotationEditor
          // A fresh box per draft: its text is the text it starts with, and
          // one press on another pin must not inherit the last one's draft.
          key={`new-${draft.page}-${draft.point.x}-${draft.point.y}`}
          x={draft.x}
          y={draft.y}
          page={draft.page}
          text={draft.text}
          saving={saving}
          error={error}
          onSave={(text) => onSaveDraft(text)}
          onCancel={() => onCancelDraft()}
        />
      )}

      {/* One pin's own menu: write it with a preview, copy the reference a note can
      point at, or drop it. Opened by right-clicking the pin, whatever tool is
      armed. */}
      {menu && (
        <AnnotationContextMenu
          x={menu.x}
          y={menu.y}
          fontPt={menu.fontPt}
          onFontPreview={(fontPt) => onFontPreview(menu.annotation, fontPt)}
          onFontSize={(fontPt) => onFontSize(menu.annotation, fontPt)}
          onEditWithPreview={() => onEditWithPreview(menu.annotation)}
          onCopyReference={() => onCopyReference(menu.annotation.id)}
          onDelete={() => onDelete(menu.annotation.id)}
          onClose={() => onCloseMenu()}
        />
      )}
    </>
  );
}
