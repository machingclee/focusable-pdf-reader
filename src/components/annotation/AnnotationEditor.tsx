/**
 * The box a **new** pin is written in, at the pointer that placed it.
 *
 * What it holds is markdown, the same writing a note holds: the content beside the
 * pin is rendered by the note card's pipeline, so a heading, a list or a
 * `[note:<id>]` written here appears as that on the page.
 *
 * It is opened by a click on empty paper with the annotation tool armed, and by that
 * alone. A pin that already exists is *changed* rather than written: double-clicking
 * it turns its own words into an editor standing on the page
 * (`AnnotationInlineEditor`), because there is a place to write in and a paragraph
 * around it that should not be covered by a box.
 *
 * Portalled to `document.body` for the reason every menu in this app is: the page it
 * opens over lives inside a scroller, a zoomed column and a stacking context of its
 * own, and a box positioned against the pointer means the same coordinates in the
 * viewport's space. It is anchored where the pointer was, kept on screen at the
 * window's edge, and dismissed by a press outside it or by Escape.
 *
 * Escape is answered by `App`, not here: the key handler that owns the page's own
 * Escape layers runs before this box is reached, and two handlers cancelling the
 * same draft would be one too many. Enter saves and Shift+Enter breaks the line,
 * which is the shape a one-to-three line note wants.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** How far the box keeps from the window's edge, in CSS px. */
const EDGE_PX = 8;

/** How far it opens from the pointer, so the click itself is not covered. */
const ANCHOR_OFFSET_PX = 10;

export type AnnotationEditorProps = {
  /** Viewport coordinates of the press that opened it. */
  x: number;
  y: number;
  /** The page the pin is on, said in the box so a far-away one is not a mystery. */
  page: number;
  /** What the box starts with. */
  text: string;
  /** A write is in flight: the box stays put and says so. */
  saving: boolean;
  /** Why the last write did not land, if it did not. */
  error: string | null;
  onSave: (text: string) => void;
  onCancel: () => void;
};

export function AnnotationEditor({
  x,
  y,
  page,
  text,
  saving,
  error,
  onSave,
  onCancel,
}: AnnotationEditorProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState(text);
  const [position, setPosition] = useState({ left: x + ANCHOR_OFFSET_PX, top: y + ANCHOR_OFFSET_PX });

  // The pin was placed, the box is where the pointer is: the caret belongs in it
  // without a second click, and the text it already holds is ready to be replaced.
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const left = Math.min(x + ANCHOR_OFFSET_PX, window.innerWidth - rect.width - EDGE_PX);
    const top = Math.min(y + ANCHOR_OFFSET_PX, window.innerHeight - rect.height - EDGE_PX);
    // Above and left of the pointer when the window has no room below and right:
    // a box with half of itself outside the window cannot be written in.
    setPosition({
      left: Math.max(EDGE_PX, left < EDGE_PX ? x - rect.width - ANCHOR_OFFSET_PX : left),
      top: Math.max(EDGE_PX, top < EDGE_PX ? y - rect.height - ANCHOR_OFFSET_PX : top),
    });
  }, [x, y]);

  // A press anywhere else puts the box away, the way the other menus are
  // dismissed. The draft goes with it: this box is a note being written on paper,
  // and a click that leaves the paper is the reader putting the pen down.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (boxRef.current?.contains(event.target as Node)) return;
      onCancel();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [onCancel]);

  const trimmed = draft.trim();
  const canSave = trimmed.length > 0 && !saving;

  return createPortal(
    <div
      ref={boxRef}
      className="ann-editor"
      style={{ left: position.left, top: position.top }}
      role="dialog"
      aria-label="New annotation"
      // The page under the box has its own press handlers; a press inside the box
      // is the box's, not the page's.
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <header className="ann-editor-head">
        <span className="ann-editor-title">New annotation</span>
        <span className="ann-editor-page">p.{page}</span>
      </header>
      <textarea
        ref={fieldRef}
        className="ann-editor-field"
        value={draft}
        rows={3}
        spellCheck
        placeholder="Write what this part of the page is about — markdown is fine…"
        aria-label="Annotation text"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Escape belongs to the window's own key handler (see the file comment).
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (canSave) onSave(trimmed);
          }
        }}
      />
      {error && (
        <p className="ann-editor-error" role="status">
          {error}
        </p>
      )}
      <footer className="ann-editor-foot">
        <button type="button" className="primary" disabled={!canSave} onClick={() => onSave(trimmed)}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </footer>
      <p className="ann-editor-hint">Enter saves · Shift+Enter breaks the line · Esc cancels</p>
    </div>,
    document.body,
  );
}
