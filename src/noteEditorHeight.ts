/**
 * How tall a card's inline note editor is, in CSS px.
 *
 * The card's editor is a window onto a fixed-size Monaco pane: the pane is given the
 * ceiling and the frame clips it, so growing the frame never re-lays-out the editor
 * (see `MarkdownNoteEditor`). Two things decide the frame's height — the note it
 * replaced, when the reader opened the editor from a card they were already reading,
 * and the draft itself, which the editor reports as lines are added and removed.
 *
 * Kept apart from the component, like `noteBandResize.ts` and `notesScroll.ts`, so the
 * floor, the ceiling and — the case that matters most — where an unmeasured frame
 * starts can be checked without Monaco. The ceiling is mirrored in `App.css` as
 * `--notes-card-editor-ceiling`; change one, change both.
 */

/**
 * Shortest the frame may be.
 *
 * About four lines at the card's 14px: a one-line note would otherwise open a field
 * too short to see a paragraph in, and the buttons under it would be the tallest
 * thing in the editor.
 */
export const MIN_NOTE_EDITOR_HEIGHT = 96;

/**
 * Tallest the frame may be, and the height Monaco itself is given.
 *
 * Past this the card would push the rest of the column out of sight while it is
 * being written, so the editor scrolls inside the frame instead.
 */
export const MAX_NOTE_EDITOR_HEIGHT = 640;

/** `height` held between the floor and the ceiling, in whole pixels. */
export function clampNoteEditorHeight(height: number): number {
  return Math.min(Math.max(Math.round(height), MIN_NOTE_EDITOR_HEIGHT), MAX_NOTE_EDITOR_HEIGHT);
}

/**
 * The height the frame starts at, before the draft's own text has been measured.
 *
 * A card opened by double-clicking its note hands over the height the note was read
 * at, so the field takes the text's place instead of resizing the card under the
 * pointer that just clicked it. A card opened from the band's **Save note** has no
 * height to hand over — the strip is new and its note is empty — and the floor is the
 * honest guess: the text is one line, and the first measurement Monaco reports lands
 * on the same number.
 *
 * Never the ceiling. The frame used to start at the full 640px whenever there was no
 * measurement, which is the height of an editor nobody asked for: the card was laid
 * out 640px tall until Monaco reported its content — a paint or three, and longer
 * while the chunk was still loading — and then snapped back down to the size of the
 * note. On a new strip, whose folder is revealing at that same moment, the reader saw
 * a card that filled the column and then shrank. The ceiling is a limit on the box,
 * not a place to start it.
 */
export function noteEditorStartHeight(measured?: number): number {
  if (measured === undefined || !Number.isFinite(measured)) return MIN_NOTE_EDITOR_HEIGHT;
  return clampNoteEditorHeight(measured);
}
