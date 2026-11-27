/**
 * The edit half of the note dialog: a Monaco pane holding the raw markdown.
 *
 * Ported from the shell-script-manager project's `MarkdownCodeEditor`. The
 * differences are the props it no longer needs (there is no second scroll
 * container to restore here, since the dialog mounts fresh each time) and
 * `automaticLayout`: the dialog switches the pane between 0-width, half-width
 * and full-width as the user changes mode, and without it Monaco would keep
 * painting at whatever size it had when it mounted.
 */
import Editor from "@monaco-editor/react";
import type { editor as monacoEditor } from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import {
  EDITOR_THEME,
  POPUP_EDITOR_THEME_PRIORITY,
  holdEditorTheme,
  installMonaco,
  type MonacoEditor,
} from "./monaco";
import { installMonacoMarkdownBehaviours } from "./monacoMarkdown";

// Side effect: points @monaco-editor/react at the local Monaco and installs the
// editor worker. Must happen before the first <Editor /> mounts.
installMonaco();

export type MarkdownCodeEditorProps = {
  content: string;
  fontSize: number;
  /** Populated with the editor instance after mount. */
  editorRef: RefObject<MonacoEditor | null>;
  onChange: (value: string) => void;
  /** Double-click a line: scroll the preview to the matching block. */
  onRevealInPreview?: (lineNumber: number) => void;
  /**
   * Start with the caret at the end of the text instead of at the top.
   *
   * The popup opens on a note being written from scratch, so the caret at the
   * top is right there; a card opens on a note that already exists and is being
   * added to, so its caret belongs where the writing stopped.
   */
  caretAtEnd?: boolean;
  /**
   * Focus the field when it is created. The card's editor is created while the
   * notes are opening, off-screen, and must not take the caret then.
   */
  autofocus?: boolean;
  /**
   * Which Monaco theme to wear. The popup's by default; a card passes its own,
   * because its surface is paper-green and the popup's neutral grey reads as a hole
   * punched in it.
   */
  theme?: string;
  /**
   * How strongly this editor's theme wins while another editor is also mounted.
   *
   * Monaco has one theme for the page. The popup passes a higher priority than the
   * card, so opening it paints the dark theme, and closing it — this component
   * unmounting — hands the page back to the card's green.
   */
  themePriority?: number;
  /**
   * The height the text needs, reported on mount and whenever it changes.
   *
   * Monaco fills whatever box it is given and scrolls inside it, so a card that has
   * to grow with its note cannot learn this from CSS — `getContentHeight()` is the
   * only source of it, and `onDidContentSizeChange` is what keeps it current as lines
   * are added, removed and wrapped.
   */
  onContentHeightChange?: (height: number) => void;
};

export function MarkdownCodeEditor({
  content,
  fontSize,
  editorRef,
  onChange,
  onRevealInPreview,
  caretAtEnd = false,
  autofocus = true,
  theme = EDITOR_THEME,
  themePriority = POPUP_EDITOR_THEME_PRIORITY,
  onContentHeightChange,
}: MarkdownCodeEditorProps) {
  // Stable ref so the onMount callback (which captures once) always calls the
  // latest handler.
  const revealRef = useRef(onRevealInPreview);
  revealRef.current = onRevealInPreview;
  const autofocusRef = useRef(autofocus);
  autofocusRef.current = autofocus;
  const caretAtEndRef = useRef(caretAtEnd);
  caretAtEndRef.current = caretAtEnd;
  /** Same, for the height report: the subscription is made once, at mount. */
  const heightRef = useRef(onContentHeightChange);
  heightRef.current = onContentHeightChange;
  const contentSizeSub = useRef<{ dispose: () => void } | null>(null);

  useEffect(
    () => () => {
      contentSizeSub.current?.dispose();
      contentSizeSub.current = null;
    },
    [],
  );

  /* Held for this editor's whole life, released on unmount. The popup mounts after
     the card and unmounts when it closes; releasing its hold is what paints the
     card green again. `@monaco-editor/react` also calls `setTheme` on creation,
     which would otherwise be the last word and leave the card dark. */
  useEffect(() => holdEditorTheme(theme, themePriority), [theme, themePriority]);

  const handleChange = useCallback(
    (value?: string) => onChange(value ?? ""),
    [onChange],
  );

  const handleMount = useCallback(
    (editor: MonacoEditor) => {
      editorRef.current = editor;
      // The popup exists to be typed into, so the caret starts in the editor
      // rather than behind the modal with nothing focused. A card editor that is
      // only warming up off-screen passes autofocus false.
      if (autofocusRef.current) editor.focus();
      installMonacoMarkdownBehaviours(editor, {
        // No preview to reveal into when the pane is embedded on its own.
        onDoubleClickLine: (line) => revealRef.current?.(line),
      });
      if (heightRef.current) {
        const report = () => heightRef.current?.(editor.getContentHeight());
        report();
        contentSizeSub.current?.dispose();
        contentSizeSub.current = editor.onDidContentSizeChange((event) => {
          // Only the height: a width change is the layout's business, and reporting
          // it would resize the box on every window drag.
          if (event.contentHeightChanged) report();
        });
      }
      if (caretAtEndRef.current) {
        const model = editor.getModel();
        if (model) {
          const lastLine = model.getLineCount();
          editor.setPosition({ lineNumber: lastLine, column: model.getLineMaxColumn(lastLine) });
          editor.revealPositionInCenterIfOutsideViewport({
            lineNumber: lastLine,
            column: model.getLineMaxColumn(lastLine),
          });
        }
      }
    },
    [editorRef],
  );

  /* The options object must keep its identity between renders.
     `@monaco-editor/react` re-applies it whenever the prop changes by reference, and
     `editor.updateOptions()` re-runs Monaco's layout — so an inline literal here meant
     every keystroke (and every height report) asked the editor to re-lay-out and
     repaint itself, which is the flash that came with each new line. Only `fontSize`
     is a real input; everything else is a constant. */
  const options = useMemo<monacoEditor.IStandaloneEditorConstructionOptions>(
    () => ({
      fontSize,
      lineHeight: Math.round(fontSize * 1.5),
      fontFamily: '"Fira code", "Fira Mono", Consolas, Menlo, Courier, monospace',
      wordWrap: "on",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderWhitespace: "none",
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      scrollbar: { vertical: "auto", horizontal: "hidden" },
      // Kept in step with `.md-preview`'s top padding in markdown.css: the
      // editor and preview should begin their text at the same height.
      padding: { top: 16, bottom: 16 },
      lineNumbers: "off",
      glyphMargin: false,
      folding: false,
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: false,
      contextmenu: false,
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      wordBasedSuggestions: "off",
      parameterHints: { enabled: false },
      automaticLayout: true,
      // Disable Monaco's custom accessibility textarea input path so that
      // CJK IME composition (e.g. 倉頡) is handled natively by the browser —
      // prevents the double-text duplication bug.
      accessibilitySupport: "off",
    }),
    [fontSize],
  );

  return (
    <div className="md-editor-pane">
      <Editor
        height="100%"
        defaultLanguage="markdown"
        value={content}
        theme={theme}
        onMount={handleMount}
        onChange={handleChange}
        options={options}
        loading={null}
      />
    </div>
  );
}
