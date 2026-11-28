/**
 * An annotation's writing, opened in the popup a note is written in.
 *
 * A pin's words are markdown — headings, lists, tables, pictures whose width the
 * reader drags, `[note:<id>]` references — and the page shows them rendered, so
 * retyping them in a field on the page means writing blind: the reader types the
 * source and can only guess at the result. The popup is where the two halves are
 * side by side. It is raised from the pin's menu as **Edit with preview**, and the
 * double-click on the pin keeps the in-place editor for the small corrections
 * (`AnnotationInlineEditor`).
 *
 * It is `MarkdownNoteDialog` — the notes column's popup, the same three view
 * modes, the same editor, preview, dragging and find — with one thing missing: a
 * note's popup opens under the page band the note is about, and a pin has no
 * strip to read its writing against. It is pinned to a point, not to a passage,
 * so the band is simply not passed and the panes take the whole height.
 *
 * The dialog's own chunk is loaded on the first open, the same one the notes
 * column uses: Monaco, react-markdown and KaTeX have no business in the bundle
 * of a viewer that may never open a pin.
 */
import { lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import type { Annotation } from "../../types/dto";
import type { AnnotationReveal, NoteReveal } from "../NoteReference";
import { useMarkdownShortcuts } from "../../markdown/useMarkdownShortcuts";

/**
 * The dialog itself, in its own chunk. The very same module the notes column
 * imports, so a reader who has opened a note is not made to download it twice.
 */
const MarkdownNoteDialog = lazy(() =>
  import("../../markdown/MarkdownNoteDialog").then((module) => ({
    default: module.MarkdownNoteDialog,
  })),
);

export type AnnotationMarkdownDialogProps = {
  /** The row being written: whose words, and the page the title names. */
  annotation: Annotation;
  /** The document the pin stands on, under the title. */
  documentName: string;
  /**
   * That document's id, so a `[note:<id>]` or `[annotation:<id>]` reference into
   * the same PDF names no document — the same rule the pin's own rendering follows.
   */
  documentId: number | null;
  /** A write is in flight: the dialog stays put and says so. */
  saving: boolean;
  /** Why the last write did not land, if it did not. */
  error: string | null;
  /** Called with the writing when the reader confirms. */
  onSave: (markdown: string) => void;
  /** Nothing was written: leave the row as it was. */
  onCancel: () => void;
  /** Show the note a `[note:<id>]` reference in the preview points at. */
  onRevealNote?: NoteReveal | null;
  /** Show the PDF a `[annotation:<id>]` reference is pinned to. */
  onRevealAnnotation?: AnnotationReveal | null;
};

export function AnnotationMarkdownDialog({
  annotation,
  documentName,
  documentId,
  saving,
  error,
  onSave,
  onCancel,
  onRevealNote = null,
  onRevealAnnotation = null,
}: AnnotationMarkdownDialogProps) {
  return (
    <Suspense fallback={<DialogLoading onCancel={onCancel} />}>
      {createPortal(
        <MarkdownNoteDialog
          // A fresh popup per row: its markdown is the state it starts with, and
          // one pin's writing must never open over another's.
          key={annotation.id}
          title={`Edit annotation · page ${annotation.page_number}`}
          subtitle={documentName}
          initialMarkdown={annotation.text}
          // No `noteId`: an annotation is not a note, so no note reference is its
          // own writing. `pdfDocumentId` is, because a reference into this PDF
          // should read the same here as it does on the page.
          pdfDocumentId={documentId}
          onRevealNote={onRevealNote}
          onRevealAnnotation={onRevealAnnotation}
          saveLabel="Save annotation"
          saving={saving}
          error={error}
          onCancel={onCancel}
          onSave={onSave}
        />,
        document.body,
      )}
    </Suspense>
  );
}

/**
 * What stands in the popup's place while its chunk is on its way: the notes
 * column's own veil and message, so the first open is a dialog arriving rather
 * than an empty backdrop. Escape drops it, exactly as it drops the dialog.
 */
function DialogLoading({ onCancel }: { onCancel: () => void }) {
  useMarkdownShortcuts({ onEscape: onCancel });
  return (
    <div className="note-backdrop" aria-busy="true">
      <div className="note-loading">Loading the annotation editor…</div>
    </div>
  );
}
