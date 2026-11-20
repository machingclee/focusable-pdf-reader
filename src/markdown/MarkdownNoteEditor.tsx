/**
 * The note popup's editor, embedded in a card.
 *
 * Double-clicking a card's note used to swap the text for a `<textarea>`: a plain
 * field that knew nothing about markdown. This is the same Monaco pane the popup
 * uses — same language, same markdown behaviours, same native IME handling — with
 * the preview left out. A card is ~300 px wide in a scrolling column, so a split
 * view would have two unusable halves; the preview belongs to the popup, where
 * there is room for it (the card's menu still opens that popup in full).
 *
 * The value is not owned here: `StripList` holds the draft, which is what lets the
 * card keep its own Save / Cancel row outside this lazily-loaded chunk and lets
 * the popup and the field share one write path (`saveRemark`).
 */
import { useCallback, useRef } from "react";
import { MarkdownCodeEditor } from "./MarkdownCodeEditor";
import { useMarkdownShortcuts } from "./useMarkdownShortcuts";
import type { MonacoEditor } from "./monaco";
// The pane's own styles (`.md-editor-pane`, Monaco's font stack and scrollbars).
// Imported here rather than in the app shell: like the popup, this chunk is only
// downloaded the first time a note is opened for editing.
import "./markdown.css";

export type MarkdownNoteEditorProps = {
  /** The note markdown being edited. */
  value: string;
  onChange: (value: string) => void;
  /** Write the note: ⌘S or ⌘Enter, and the card's own **Save note**. */
  onSave: () => void;
  /** Leave the field without writing: `Esc`, and the card's **Cancel**. */
  onCancel: () => void;
};

/** Card-sized type: the popup's 16px is a document, not a 300px column. */
const CARD_FONT_SIZE = 14;

export function MarkdownNoteEditor({
  value,
  onChange,
  onSave,
  onCancel,
}: MarkdownNoteEditorProps) {
  const editorRef = useRef<MonacoEditor | null>(null);

  // Bound at the window, like the popup's: Monaco handles several of these keys
  // itself and stops them from bubbling, so a handler on the wrapper would never
  // see `Esc` — and typing `Esc` into a note that cannot leave it is worse than
  // the shortcut reaching a little further than the field.
  const save = useCallback(() => onSave(), [onSave]);
  useMarkdownShortcuts({ onSave: save, onSubmit: save, onEscape: onCancel });

  return (
    <div className="notes-card-monaco">
      <MarkdownCodeEditor
        content={value}
        fontSize={CARD_FONT_SIZE}
        editorRef={editorRef}
        onChange={onChange}
        caretAtEnd
      />
    </div>
  );
}
