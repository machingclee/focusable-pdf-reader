/**
 * Where a drag may start.
 *
 * The whole card and the whole folder header are the drag activators now — the
 * strip's preview included, since it is the biggest part of a card to grab. Only
 * the places that genuinely need the pointer for themselves opt out:
 *
 *  - text fields: a press there has to place a caret and drag a selection;
 *  - lists: opening a `<select>` is a click, not the start of a card drag;
 *  - a document row's rename controls: Save and Cancel are clicks, and the
 *    field beside them is already covered by `input`.
 *
 * The drag-vs-click line is drawn by the sensors instead: a press has to travel
 * `DRAG_DISTANCE_PX` before the card is picked up, so a press that stays put
 * still reaches the preview's own click (open the strip) or the note's
 * double-click (edit it).
 */
const KEEPS_THE_POINTER = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  // The note's embedded markdown editor. Monaco keeps its keyboard surface in a
  // <textarea>, but its *text* is a stack of divs, so a press on the text would
  // otherwise be grabbed as a card drag the moment the pointer travelled
  // `DRAG_DISTANCE_PX` — and selecting a sentence would move the card instead.
  ".monaco-editor",
  ".notes-doc-rename",
].join(", ");

/** True when a press on `target` should begin dragging the enclosing row. */
export function startsDrag(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(KEEPS_THE_POINTER) === null;
}
