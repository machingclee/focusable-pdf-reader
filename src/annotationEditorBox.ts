/**
 * How big a pin's inline editor is, in CSS px.
 *
 * The editor stands *on* the page, so its size is the page's: the annotation's type
 * grows with `--zoom`, and so does the room below the pin. Monaco, by contrast, takes
 * a font size and a line height in whole pixels, and has to be told how tall its box
 * is before it will lay anything out. Both conversions live here, apart from the
 * component, the way `noteEditorHeight.ts` keeps the card's floor and ceiling, so the
 * awkward cases can be read and tested without an editor:
 *
 * - a one-line note opens on a couple of lines of room, never a hairline field;
 * - a pin on the last line of its page has no room below it at all, and keeps that
 *   same floor — the room is the ceiling, not a measurement;
 * - a long note is clipped at the page's own room, so the writer scrolls inside the
 *   sheet instead of writing past its bottom.
 */
import { ANNOTATION_FONT_PT, ANNOTATION_LINE_PT, annotationFontPt } from "./annotation";

/**
 * Line spacing over type size, as the page sets an annotation's writing.
 *
 * Kept because the editor must read as the words it replaced: a fixed 1.5 leading
 * would respace the paragraph the moment the double-click landed on it.
 */
export const ANNOTATION_EDITOR_LEADING = ANNOTATION_LINE_PT / ANNOTATION_FONT_PT;

/** Lines of room the box keeps even when the writing is one line. */
export const ANNOTATION_EDITOR_MIN_LINES = 2;

/**
 * The zoom the page is drawn at, read back from the type it draws the writing in.
 *
 * The component can measure a rendered `font-size` but not the `--zoom` behind it —
 * the custom property is the stylesheet's, and a double-click should not have to go
 * through the store for a number CSS already applied. `basePt` is the pin's own size
 * on paper, which is what the page multiplied by the zoom: a writing taken up to
 * 14 pt at 150% renders 21 px, and the zoom is still 1.5.
 */
export function annotationZoomOfType(fontSize: number, basePt = ANNOTATION_FONT_PT): number {
  const base = annotationFontPt(basePt);
  const type = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : base;
  return type / base;
}

/** One line of the writing at `fontSize` px, in whole px: the page's own leading. */
export function annotationEditorLineHeight(fontSize: number): number {
  const type = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : ANNOTATION_FONT_PT;
  return Math.max(1, Math.round(type * ANNOTATION_EDITOR_LEADING));
}

/** The shortest the box may be: a couple of lines, whatever the page has below. */
export function annotationEditorFloor(fontSize: number): number {
  return annotationEditorLineHeight(fontSize) * ANNOTATION_EDITOR_MIN_LINES;
}

/**
 * The room the page has below the pin, in px at this zoom.
 *
 * That is the pane's constant height. It is never below the floor: a pin on the last
 * line of its page still has to be writable, and an editor a hair tall would be a
 * field the reader cannot see their own sentence in.
 */
export function annotationEditorRoom(
  pageHeightPt: number,
  pinYPt: number,
  fontSize: number,
  basePt = ANNOTATION_FONT_PT,
): number {
  const below = Math.max(0, (pageHeightPt > 0 ? pageHeightPt : 0) - pinYPt);
  const px = below * annotationZoomOfType(fontSize, basePt);
  return Math.round(Math.max(annotationEditorFloor(fontSize), px));
}

/**
 * The height the frame needs for the text, in whole px.
 *
 * Below the floor it is the floor; above the room it is the room, and anything past
 * that scrolls inside the pane. A report that is not a number (Monaco's first frame,
 * while its layout is still zero) falls back to the floor rather than to nothing.
 */
export function annotationEditorHeight(
  contentHeight: number,
  fontSize: number,
  room: number,
): number {
  const floor = annotationEditorFloor(fontSize);
  const wanted = Number.isFinite(contentHeight) ? contentHeight : floor;
  return Math.round(Math.min(Math.max(wanted, floor), Math.max(floor, room)));
}
