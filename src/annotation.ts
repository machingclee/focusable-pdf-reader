/**
 * Where a pin sits, and what it looks like, on every surface that draws one.
 *
 * An annotation is a point on a page — `x` and `y`, in PDF points, from the
 * top-left corner of the sheet — plus the text the reader wrote. Three surfaces
 * draw that: the page in the viewer (as a DOM control, so it can be clicked and
 * hovered), a note card's band preview, and the picture in the exported HTML.
 * The last two draw into a canvas, and this module is the maths both of them use,
 * so a pin lands on the same spot in the app and in the file.
 *
 * Kept free of the DOM and of React for the same reason `stripHighlight` is: the
 * awkward parts — a band that crops the pin away, text that has to wrap inside a
 * card, a bubble that would open off the page — are answers this module gives,
 * and a test can read them without a canvas.
 */
import { markdownText } from "./notesText";
import { previewScale, type HighlightBox, type PagePoint } from "./stripHighlight";

/** One saved pin, as a strip's preview receives it. The page is the strip's. */
export type PageAnnotation = {
  id: number;
  /** Left edge of the pin, in PDF points. */
  x: number;
  /** Top edge of the pin, in PDF points, from the top of the page. */
  y: number;
  /** Width of the content, in PDF points. The reader drags the content's edge. */
  width: number;
  /** Markdown. The note card's pipeline renders it. */
  text: string;
};

/** The pin's square side, in PDF points. Scales with the page, like a mark does. */
export const ANNOTATION_PIN_PT = 12;

/** How wide a pin's content starts, in PDF points. */
export const ANNOTATION_WIDTH_DEFAULT_PT = 150;

/** The narrowest the content may be dragged, in points: below this, nothing wraps. */
export const ANNOTATION_WIDTH_MIN_PT = 60;

/** Ink of the pin and the card's edge. Deliberately not the highlight yellow. */
export const ANNOTATION_INK = "#2f6fed";

/**
 * How far past a pin's square a press still counts as on it, in CSS pixels.
 *
 * A length on screen rather than on the page, like a mark's slack: a right-click
 * just beside the pin is still a right-click on it, at every zoom.
 */
export const ANNOTATION_HIT_SLACK_PX = 6;

/** Ink of the text inside the card. Darker than the pin, so it can be read. */
export const ANNOTATION_TEXT_INK = "#16224a";

/**
 * The card's type, in PDF points.
 *
 * Bigger than the type it was first drawn at, and deliberately so: a pin is read at
 * a glance, and at reading zoom 7.5 pt was a squint. It is the same in a note's
 * preview (the painter multiplies it by the preview's own scale) and on the page
 * (CSS multiplies it by `--zoom`), which is the point of keeping it here.
 */
export const ANNOTATION_FONT_PT = 10.5;

/** Distance between two lines of the card, in PDF points: the type plus leading. */
export const ANNOTATION_LINE_PT = 13.5;

/** How many lines of text a card shows before it is cut off. */
export const ANNOTATION_MAX_LINES = 4;

/**
 * How much room an average character takes, as a fraction of the font size.
 *
 * Canvas could measure each string, but the wrap is also what decides whether a
 * card fits at all, and an answer that needs a canvas cannot be written in a test.
 * A proportional estimate is close enough for a card that is 104 pt wide: the
 * worst a few points of drift does is leave a word on the next line.
 */
const CHARACTER_WIDTH_RATIO = 0.55;

/** A pin and its content, in PDF points: the layout the page places by. */
export type PageAnnotationBoxes = {
  /** The pin's side, in points. Its top-left corner is the stored point. */
  size: number;
  /**
   * The content, relative to the pin's corner: to its right, its first line level
   * with the pin. Null when the page leaves no room for any of it.
   *
   * There is no height: the content is markdown with a natural height, so the page
   * lets the DOM lay it out and takes only the width and the corner from here.
   */
  card: { left: number; top: number; width: number } | null;
};

/** A pin's box and its text card, in the same pixel space as the canvas. */
export type AnnotationMark = {
  id: number;
  /** The square head of the pin. */
  pin: HighlightBox;
  /** The card holding the text, already placed on the page. */
  card: HighlightBox;
  /** The text, wrapped and cut to `ANNOTATION_MAX_LINES`. */
  lines: string[];
};

/** Marks stored on a strip, or none when the column is empty or unreadable. */
export function parseStripAnnotations(raw: string | null | undefined): PageAnnotation[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "number" || !Number.isFinite(row.id)) return [];
    if (typeof row.x !== "number" || !Number.isFinite(row.x)) return [];
    if (typeof row.y !== "number" || !Number.isFinite(row.y)) return [];
    if (typeof row.text !== "string") return [];
    // A row stored before the content had a width is drawn at the default one.
    const width =
      typeof row.width === "number" && Number.isFinite(row.width)
        ? row.width
        : ANNOTATION_WIDTH_DEFAULT_PT;
    return [{ id: row.id, x: row.x, y: row.y, width, text: row.text }];
  });
}

/**
 * Where a pin's point is on its page, as a fraction from the top.
 *
 * This is what a reference scrolls to: the reader asked to be shown the pin, and
 * the pin's own line is put on the reading line — a fifth of the way down, the
 * same line a saved note is parked on.
 */
export function annotationPointFrac(annotation: PageAnnotation, pageHeight: number): number {
  const height = pageHeight > 0 ? pageHeight : 1;
  const frac = annotation.y / height;
  return Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 0));
}

/**
 * A click turned into a pin's corner, kept on the paper.
 *
 * The pin grows right and down from its corner, so the clamp reserves the square
 * itself: a click on the last two points of a page would otherwise hang the pin
 * off the sheet, where half of it cannot be seen or hit.
 */
export function clampAnnotationPoint(
  x: number,
  y: number,
  pageWidth: number,
  pageHeight: number,
): PagePoint {
  const right = Math.max(0, (pageWidth > 0 ? pageWidth : 1) - ANNOTATION_PIN_PT);
  const bottom = Math.max(0, (pageHeight > 0 ? pageHeight : 1) - ANNOTATION_PIN_PT);
  return {
    x: Math.min(Math.max(x, 0), right),
    y: Math.min(Math.max(y, 0), bottom),
  };
}

/**
 * The pin under a point, as its index in `annotations`, or null on paper.
 *
 * Only the **pin** is hit-tested from geometry. The content beside it is a live
 * markdown surface — links, picture edges, a right-click of its own — so it answers
 * for itself in the DOM, and a box guessed from the stored width would be wrong the
 * moment a heading or a picture changed the content's height.
 *
 * `point` is in PDF points with `y` from the top of the page. `slack` widens the
 * square, so a press just beside a pin still lands. Later pins win where two
 * overlap, like marks do.
 */
export function annotationAtPoint(
  annotations: readonly PageAnnotation[],
  point: PagePoint,
  _page: { width: number },
  slack = 0,
): number | null {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index];
    if (!annotation) continue;
    const { x, y } = annotation;
    if (point.x < x - slack || point.x > x + ANNOTATION_PIN_PT + slack) continue;
    if (point.y < y - slack || point.y > y + ANNOTATION_PIN_PT + slack) continue;
    return index;
  }
  return null;
}

/**
 * Break text into lines that fit `widthPt` at `fontPt`, cut to `maxLines`.
 *
 * Words are kept whole — a break inside a word is unreadable at this size — an
 * empty paragraph is dropped, and a line that has more to say is ellipsised
 * rather than dropped: the reader has to be able to tell there is more.
 */
export function wrapAnnotationText(
  text: string,
  widthPt: number,
  fontPt = ANNOTATION_FONT_PT,
  maxLines = ANNOTATION_MAX_LINES,
): string[] {
  const perCharacter = fontPt * CHARACTER_WIDTH_RATIO;
  const perLine = Math.max(1, Math.floor((widthPt > 0 ? widthPt : 1) / perCharacter));
  const paragraphs = text.replace(/\r\n?/g, "\n").split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= perLine) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      // A single word longer than the line is cut, or the card would never fit.
      current = word.length <= perLine ? word : cutWord(word, perLine);
    }
    if (current) lines.push(current);
  }

  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1] ?? "";
  kept[maxLines - 1] = last.length < perLine ? `${last}…` : `${last.slice(0, perLine - 1)}…`;
  return kept;
}

function cutWord(word: string, perLine: number): string {
  if (perLine <= 1) return word.slice(0, 1);
  return `${word.slice(0, perLine - 1)}…`;
}

/**
 * How far the card sits from the pin, in points.
 *
 * An air gap rather than a hairline: the pin is the mark on the page, the card is
 * what was written about it, and the two read as one piece without touching.
 */
const CARD_GAP_PT = 6;

/** The pad inside the card, in points: room above and below the lines, and a bar. */
const CARD_PAD_PT = 1;

/**
 * A pin's box on its page, in PDF points.
 *
 * **This is the one place the pair is laid out.** The page draws the numbers it
 * returns as DOM, and a preview paints from the same width — so content that sits at
 * a width in the viewer sits at that width in a note's preview of the page.
 *
 * The content is always on the pin's **right**, level with its first line, because
 * that is what it is: the writing that follows the mark. It never turns, and never
 * picks a side — an annotation that rearranged itself as it was dragged across the
 * page would read as a second, different annotation. A pin with no room beside it
 * (hard against the right edge) gets as much width as there is; below a readable
 * width it gets none and the pin stands alone, which the viewer is one click away
 * from explaining.
 *
 * `annotation.width` is the reader's own choice, kept on the row; the page caps it
 * at the room it actually has, so the content can never run off the paper.
 */
export function annotationPageBoxes(
  annotation: PageAnnotation,
  page: { width: number },
): PageAnnotationBoxes {
  const pageWidth = page.width > 0 ? page.width : 1;
  const size = ANNOTATION_PIN_PT;
  const cardLeft = size + CARD_GAP_PT;
  const wanted = Number.isFinite(annotation.width) ? annotation.width : ANNOTATION_WIDTH_DEFAULT_PT;
  const width = Math.min(
    Math.max(wanted, ANNOTATION_WIDTH_MIN_PT),
    Math.max(0, pageWidth - annotation.x - cardLeft),
  );
  if (width < 8) return { size, card: null };
  // The content's first line is what the pin sits beside, so the content is shifted
  // up until that line's middle is the pin's middle: the two read as one row.
  return { size, card: { left: cardLeft, top: size / 2 - ANNOTATION_LINE_PT / 2, width } };
}

/**
 * A pin's boxes on a band preview.
 *
 * `band` is the strip's part of the page and `cssWidth` the width the preview is
 * drawn at; the pin is placed relative to the band's top edge, so it lands on the
 * same words the viewer draws it over. `null` when the pin is off the band
 * entirely: the picture is a crop, and a card for a pin outside it is nothing.
 *
 * The card's box and lines come from `annotationPageBoxes`, so the preview draws the
 * page's own layout rather than a second opinion about it.
 */
export function annotationMark(
  annotation: PageAnnotation,
  band: { top: number; height: number; page_width: number },
  cssWidth: number,
): AnnotationMark | null {
  const scale = previewScale(cssWidth, band.page_width);
  const top = (annotation.y - band.top) * scale;
  const size = ANNOTATION_PIN_PT * scale;
  const bandHeight = Math.max(0, band.height) * scale;
  if (top + size <= 0 || top >= bandHeight) return null;

  const boxes = annotationPageBoxes(annotation, { width: band.page_width });
  const pin = { left: annotation.x * scale, top, width: size, height: size };
  if (!boxes.card) {
    // No room beside the pin on this page: the pin alone still says something is
    // written here, and the viewer is one click away.
    return { id: annotation.id, pin, card: { left: 0, top: 0, width: 0, height: 0 }, lines: [] };
  }

  // A picture cannot render markdown: the canvas shows the writing's words, wrapped
  // to the content's own width, so the shape of the note is still there.
  const lines = wrapAnnotationText(markdownText(annotation.text), boxes.card.width);
  const height = Math.max(size, lines.length * ANNOTATION_LINE_PT + 2 * CARD_PAD_PT);
  return {
    id: annotation.id,
    pin,
    card: {
      left: pin.left + boxes.card.left * scale,
      top: top + boxes.card.top * scale,
      width: boxes.card.width * scale,
      height: height * scale,
    },
    lines,
  };
}

/** Every pin that lands on the band, in the same pixel space as `widthPx`. */
export function annotationMarks(
  annotations: readonly PageAnnotation[],
  band: { top: number; height: number; page_width: number },
  widthPx: number,
): AnnotationMark[] {
  return annotations.flatMap((annotation) => {
    const mark = annotationMark(annotation, band, widthPx);
    return mark ? [mark] : [];
  });
}

/**
 * Lay the pins onto a page that is already painted.
 *
 * Drawn over the marks, not multiplied into them: a highlight is a wash of colour
 * on the words, while a pin is a thing standing on the page, and its white text on
 * the blue head has to stay white. `source-over` is set explicitly for that — the
 * highlight pass before it leaves the context on `multiply`.
 */
export function paintAnnotationsOnPage(
  canvas: HTMLCanvasElement,
  annotations: readonly PageAnnotation[],
  band: { top: number; height: number; page_width: number },
): void {
  if (annotations.length === 0) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const marks = annotationMarks(annotations, band, canvas.width);
  if (marks.length === 0) return;
  const scale = previewScale(canvas.width, band.page_width);

  context.save();
  // The page render shifts this context so the band sits at y = 0 and may leave
  // that shift in place. The marks are already canvas pixels.
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.textBaseline = "top";

  for (const mark of marks) {
    drawPin(context, mark);
    if (mark.card.width > 0 && mark.lines.length > 0) drawCard(context, mark, scale);
  }
  context.restore();
}

function drawPin(context: CanvasRenderingContext2D, mark: AnnotationMark): void {
  const { pin } = mark;
  const radius = Math.max(1.5, pin.width * 0.28);
  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(pin.left, pin.top, pin.width, pin.height, radius);
  } else {
    context.rect(pin.left, pin.top, pin.width, pin.height);
  }
  context.fillStyle = ANNOTATION_INK;
  context.fill();
}

function drawCard(context: CanvasRenderingContext2D, mark: AnnotationMark, scale: number): void {
  const { card } = mark;
  const fontPx = Math.max(4, ANNOTATION_FONT_PT * scale);
  const linePx = Math.max(fontPx + 1, ANNOTATION_LINE_PT * scale);
  // The words and nothing else, matching the page: the content has no box of its
  // own there, so the picture gives it no box either.
  context.fillStyle = ANNOTATION_TEXT_INK;
  context.font = `${Math.round(fontPx * 10) / 10}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  mark.lines.forEach((line, index) => {
    const y = card.top + 1 * scale + index * linePx;
    if (y + linePx > card.top + card.height + 1) return;
    context.fillText(line, card.left, y, Math.max(0, card.width));
  });
}
