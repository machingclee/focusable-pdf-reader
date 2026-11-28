/**
 * What makes an annotation a thing this app can paint and point at.
 *
 * A pin is placed by a click, so its place is the reader's business — but it has
 * to be a point on the page the document actually has, and its text has to be
 * something. The rules live here, in one place, because the create and the edit
 * check the same thing and a second copy of "trimmed, not empty" is how the two
 * end up disagreeing.
 */
import { ErrorFactory } from "../../../common/http.ts";

/** The longest text a pin may hold. Long enough for a paragraph, short enough to draw. */
export const ANNOTATION_TEXT_MAX = 10_000;

/** How wide a pin's content starts, in PDF points. */
export const ANNOTATION_WIDTH_DEFAULT = 150;

/** The narrowest a content edge may be dragged, in points: below this, nothing wraps. */
export const ANNOTATION_WIDTH_MIN = 60;

/** The widest, in points: wider than a page, so it only stops nonsense. */
export const ANNOTATION_WIDTH_MAX = 1_200;

/** A content width, rounded to hundredths of a point like the placement. */
export function checkedAnnotationWidth(raw: number): number {
  if (!Number.isFinite(raw)) throw ErrorFactory.ofBadRequest("width must be a finite number of PDF points");
  const width = Math.round(raw * 100) / 100;
  if (width < ANNOTATION_WIDTH_MIN || width > ANNOTATION_WIDTH_MAX) {
    throw ErrorFactory.ofBadRequest(
      `width must be between ${ANNOTATION_WIDTH_MIN} and ${ANNOTATION_WIDTH_MAX} PDF points`,
    );
  }
  return width;
}

/**
 * The type size a pin's writing starts at, in PDF points.
 *
 * A step under the page's own body type at reading zoom, because a margin note is
 * read beside the passage rather than instead of it — the size the viewer has drawn
 * a pin's writing at since it was first painted, and the one a pin created today
 * starts at.
 */
export const ANNOTATION_FONT_DEFAULT = 9;

/** The smallest a writing may be taken to: below this it stops being readable. */
export const ANNOTATION_FONT_MIN = 5;

/**
 * The largest, on the other side of the same distance.
 *
 * The range is centred on the default — 5 to 13 around 9 — because the viewer's
 * control is a slider whose middle is that default: the reader goes left for
 * smaller and right for bigger, and the same travel either way is the same change.
 * Widening it has to move both ends together, or the middle stops being the size a
 * pin is written at.
 */
export const ANNOTATION_FONT_MAX = 13;

/**
 * A type size, rounded to hundredths of a point like a placement.
 *
 * The reader takes it up and down from the pin's menu, so the values are the
 * viewer's, not a free-typed number: the rule is a bound, and the bound is what
 * keeps a page's margin readable.
 */
export function checkedAnnotationFontSize(raw: number): number {
  if (!Number.isFinite(raw)) {
    throw ErrorFactory.ofBadRequest("font_size must be a finite number of PDF points");
  }
  const font = Math.round(raw * 100) / 100;
  if (font < ANNOTATION_FONT_MIN || font > ANNOTATION_FONT_MAX) {
    throw ErrorFactory.ofBadRequest(
      `font_size must be between ${ANNOTATION_FONT_MIN} and ${ANNOTATION_FONT_MAX} PDF points`,
    );
  }
  return font;
}

/** The text as it is stored: trimmed, non-empty, within the cap. */
export function checkedAnnotationText(raw: string): string {
  const text = raw.trim();
  if (text.length === 0) throw ErrorFactory.ofBadRequest("text must not be empty");
  if (text.length > ANNOTATION_TEXT_MAX) {
    throw ErrorFactory.ofBadRequest(`text must be at most ${ANNOTATION_TEXT_MAX} characters`);
  }
  return text;
}

/**
 * A placement on a document's page, checked against that document.
 *
 * `pageCount` is null on a row whose page count was never recorded; the page
 * number is then only required to be positive, because the alternative is a
 * document nobody can annotate until it is re-opened to learn its page count.
 *
 * The coordinates are not clipped here: they come from the page the reader
 * clicked, so a value outside the page is a broken client rather than an
 * annotation to bend into place. The page's own size is not on the document row,
 * which is why only a sanity bound is enforced.
 */
export function checkedPlacement(
  pageNumber: number,
  x: number,
  y: number,
  pageCount: number | null,
): { page_number: number; x: number; y: number } {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw ErrorFactory.ofBadRequest("page_number must be a positive integer");
  }
  if (pageCount !== null && pageNumber > pageCount) {
    throw ErrorFactory.ofBadRequest(`page_number must be at most ${pageCount} for this document`);
  }
  if (!Number.isFinite(x) || x < 0 || !Number.isFinite(y) || y < 0) {
    throw ErrorFactory.ofBadRequest("x and y must be finite, non-negative PDF points");
  }
  return { page_number: pageNumber, x: roundPt(x), y: roundPt(y) };
}

/** Hundredths of a point, the same rounding the viewer's own lists use. */
function roundPt(value: number): number {
  return Math.round(value * 100) / 100;
}
