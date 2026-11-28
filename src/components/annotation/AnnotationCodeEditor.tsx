/**
 * A pin's writing in a Monaco pane that paints no surface of its own.
 *
 * This is the lazy half of the inline annotation editor (`AnnotationInlineEditor`):
 * the shell around it is small and is in the app's own bundle, while Monaco is a
 * megabyte of editor that only has to arrive the first time a reader double-clicks a
 * pin. `MarkdownCodeEditor` is the same pane the note card and the popup use — same
 * markdown language, same behaviours, same native IME path — so a pin and a note are
 * edited by the same tool.
 *
 * Two things differ from the card's pane, both because this one stands on a page:
 *
 * - the theme paints no background at all (`ANNOTATION_EDITOR_THEME`): the white sheet
 *   the reader types on belongs to the box around the pane (`App.css`), so it keeps
 *   the box's rounded corners and ring, and a second surface inside the pane would
 *   only paint over them;
 * - there is almost no padding (`padding`), because the first line has to land where
 *   the writing's first line was instead of being pushed down inside a field.
 *
 * The height is the shell's business: Monaco is given the full room the page has
 * below the pin and the shell clips it to the height the text needs, so a new line
 * never re-lays-out the editor (see `AnnotationInlineEditor`).
 */
import { useRef } from "react";
import { MarkdownCodeEditor } from "../../markdown/MarkdownCodeEditor";
import {
  ANNOTATION_EDITOR_THEME,
  ANNOTATION_EDITOR_THEME_PRIORITY,
  type MonacoEditor,
} from "../../markdown/monaco";
import { annotationEditorLineHeight } from "../../annotationEditorBox";
// The pane's own styles (`.md-editor-pane`, Monaco's font stack and scrollbars),
// imported with the chunk that needs them rather than in the app shell.
import "../../markdown/markdown.css";

/**
 * The pane's inner padding, in CSS px.
 *
 * A card's 16px is the room a column wants at its edges; here the pane is standing in
 * for a run of words, so almost none: the first line has to land on the line the
 * writing's first line occupied.
 */
const PANE_PADDING_PX = 2;

export type AnnotationCodeEditorProps = {
  /** The markdown being changed. */
  value: string;
  /** The pane's type, in CSS px — the annotation's own size at the current zoom. */
  fontSize: number;
  onChange: (value: string) => void;
  /** The text's own height, reported so the shell can follow it. */
  onContentHeightChange: (height: number) => void;
};

export function AnnotationCodeEditor({
  value,
  fontSize,
  onChange,
  onContentHeightChange,
}: AnnotationCodeEditorProps) {
  const editorRef = useRef<MonacoEditor | null>(null);

  return (
    <MarkdownCodeEditor
      content={value}
      fontSize={fontSize}
      padding={PANE_PADDING_PX}
      // The page's own leading, so the words do not respace under the editor.
      lineHeight={annotationEditorLineHeight(fontSize)}
      editorRef={editorRef}
      onChange={onChange}
      onContentHeightChange={onContentHeightChange}
      // The caret belongs where the writing stopped, as in a card.
      caretAtEnd
      autofocus
      theme={ANNOTATION_EDITOR_THEME}
      themePriority={ANNOTATION_EDITOR_THEME_PRIORITY}
    />
  );
}
