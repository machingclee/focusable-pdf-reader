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
import { useCallback, useLayoutEffect, useRef } from "react";
import { MarkdownCodeEditor } from "./MarkdownCodeEditor";
import { CARD_EDITOR_THEME, type MonacoEditor } from "./monaco";
import { useMarkdownShortcuts } from "./useMarkdownShortcuts";
import { clampNoteEditorHeight, noteEditorStartHeight } from "../noteEditorHeight";
// The pane's own styles (`.md-editor-pane`, Monaco's font stack and scrollbars).
// Imported here rather than in the app shell: this chunk is downloaded when the
// notes open, which is also when the one card editor is created.
import "./markdown.css";

export type MarkdownNoteEditorProps = {
  /** The note markdown being edited. */
  value: string;
  onChange: (value: string) => void;
  /** Write the note: ⌘S or ⌘Enter, and the card's own **Save note**. */
  onSave: () => void;
  /** Leave the field without writing: `Esc`, and the card's **Cancel**. */
  onCancel: () => void;
  /**
   * Where the editor starts, in px — the height the note had while it was being read,
   * so the card does not jump under the double-click that opened this. The content
   * takes over from there: the box grows and shrinks with the lines in it.
   */
  height?: number;
  /**
   * The note this field is open on, or null while it is parked off-screen.
   * Changing it puts the caret at the end. The editor itself is not recreated.
   */
  openId?: number | null;
};

/* The frame's floor and ceiling, and where it starts, live in `noteEditorHeight.ts`:
   the numbers are the card's layout, and the rule for a card opened with nothing to
   measure is the one that has to stay honest. The ceiling is also the height Monaco
   itself is given (`.notes-card-monaco .md-editor-pane`, from
   `--notes-card-editor-ceiling`), so the clip never resizes the editor. */

/** Card-sized type: the popup's 16px is a document, not a 300px column. */
const CARD_FONT_SIZE = 14;

export function MarkdownNoteEditor({
  value,
  onChange,
  onSave,
  onCancel,
  height,
  openId = null,
}: MarkdownNoteEditorProps) {
  const editorRef = useRef<MonacoEditor | null>(null);
  /** The box the editor fills. Its height is written directly, not from state. */
  const frameRef = useRef<HTMLDivElement | null>(null);
  // Read at the moment a note opens. Listing `value` as an effect dependency would
  // put the caret back at the end on every keystroke.
  const valueRef = useRef(value);
  valueRef.current = value;

  /**
   * The card's editor is sized by its text: press Enter and the box gets a line
   * taller, delete a paragraph and it comes back down. Monaco scrolls inside whatever
   * box it is given, so the box is the thing that has to follow the content.
   *
   * The height is written on the element rather than kept in state on purpose. A
   * state update per line re-rendered this component, the `<Editor>` above it and the
   * whole card — and each of those renders repainted the editor, which is the flicker
   * that came with every Enter. One direct style write is one resize, one layout.
   */
  const applyHeight = useCallback((wanted: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    const next = clampNoteEditorHeight(wanted);
    // Sub-pixel reports would still cost a layout; only a real change is worth one.
    if (Math.abs(frame.getBoundingClientRect().height - next) < 0.5) return;
    frame.style.height = `${next}px`;
  }, []);

  // Where the editor starts: the height the note had while it was being read, so the
  // card opens at the size it was and only then follows the text. A card with no
  // height to hand over — one saved from the band, whose note is still empty — starts
  // at the floor rather than at the ceiling: the ceiling is a limit on the box, not a
  // starting point (see `noteEditorStartHeight` in `noteEditorHeight.ts`).
  // Run for every note that is opened, not only the first: this component is created
  // once, when the notes appear, and then moved onto whichever card is edited.
  useLayoutEffect(() => {
    if (openId == null) return;
    const frame = frameRef.current;
    const editor = editorRef.current;
    if (frame) frame.style.height = `${noteEditorStartHeight(height)}px`;
    if (!editor) return;
    // The pane's own value effect runs after paint. Setting the text here, in the
    // same frame the field is moved onto the card, is what keeps the first open
    // from painting an empty box and then filling it.
    const next = valueRef.current;
    if (editor.getValue() !== next) editor.setValue(next);
    const model = editor.getModel();
    if (model) {
      const lastLine = model.getLineCount();
      const column = model.getLineMaxColumn(lastLine);
      editor.setPosition({ lineNumber: lastLine, column });
      editor.revealPositionInCenterIfOutsideViewport({ lineNumber: lastLine, column });
    }
    editor.layout();
    editor.render(true);
    editor.focus();
  }, [openId, height]);

  // Bound at the window, like the popup's: Monaco handles several of these keys
  // itself and stops them from bubbling, so a handler on the wrapper would never
  // see `Esc` — and typing `Esc` into a note that cannot leave it is worse than
  // the shortcut reaching a little further than the field. Suspended while the
  // field is parked, or Escape while reading the list would close an editor
  // that is not on screen.
  const save = useCallback(() => onSave(), [onSave]);
  useMarkdownShortcuts({ enabled: openId != null, onSave: save, onSubmit: save, onEscape: onCancel });

  return (
    <div className="notes-card-monaco" ref={frameRef}>
      <MarkdownCodeEditor
        content={value}
        fontSize={CARD_FONT_SIZE}
        editorRef={editorRef}
        onChange={onChange}
        caretAtEnd={openId != null}
        autofocus={openId != null}
        // The card's own green, rather than the popup's neutral grey.
        theme={CARD_EDITOR_THEME}
        onContentHeightChange={applyHeight}
      />
    </div>
  );
}
