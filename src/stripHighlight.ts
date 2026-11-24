/**
 * Yellow marks on a note's page preview.
 *
 * A mark is a horizontal stroke in PDF points, the same space the strip's band
 * is saved in, so it stays on the words when the column changes width. `x0` and
 * `x1` are the ends, `y` is the top edge measured from the top of the page, and
 * `size` is the thickness. The pointer sits on that top-left corner, so the
 * click is where the mark starts rather than the middle of a block. The preview
 * draws the stroke; this module only answers where it sits and how the brush
 * keys change it.
 *
 * The stroke is horizontal on purpose. The first click chooses the line (`y`)
 * and one end; the second click chooses the other end and is not allowed to
 * tilt the stroke. `[` and `]` change the thickness, in the same direction the
 * reading strip uses for its height.
 */

export type StripHighlight = {
  x0: number;
  x1: number;
  y: number;
  size: number;
};

/** A mark placed on the preview, in CSS pixels of the page. */
export type HighlightBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** A point in PDF points. `y` is from the top of the page. */
export type PagePoint = { x: number; y: number };

/**
 * Thickness of a new stroke, in PDF points.
 *
 * One point is one CSS pixel on the page at 100% zoom, so 16 matches the note
 * text and covers one line of it.
 */
export const DEFAULT_BRUSH_PT = 16;
export const MIN_BRUSH_PT = 2;
export const MAX_BRUSH_PT = 72;

/** How far the idle brush extends past the pointer, just enough to see the colour. */
const BRUSH_LEAD_PX = 10;

/** A second click this close to the first, in PDF points, does not commit a mark. */
const MIN_SPAN_PT = 1;

export function clampBrush(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_BRUSH_PT;
  return Math.min(MAX_BRUSH_PT, Math.max(MIN_BRUSH_PT, size));
}

/**
 * How many points `[` / `]` move the brush.
 *
 * Option is a single point. Shift triples the step, and Command triples it
 * again, matching the reading strip's own brackets.
 */
export function brushStep(event: { altKey: boolean; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): number {
  if (event.altKey) return 1;
  const coarse = event.metaKey || event.ctrlKey ? 3 : 1;
  return 2 * (event.shiftKey ? 3 : 1) * coarse;
}

/** Marks stored on the strip, or none when the column is empty or unreadable. */
export function parseHighlights(raw: string | null | undefined): StripHighlight[] {
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
    const mark = item as Record<string, unknown>;
    if (!isFiniteNumber(mark.x0) || !isFiniteNumber(mark.x1) || !isFiniteNumber(mark.y)) return [];
    if (!isFiniteNumber(mark.size) || mark.size <= 0) return [];
    return [{ x0: mark.x0, x1: mark.x1, y: mark.y, size: mark.size }];
  });
}

/** A stroke on a document. `page` is 1-based, the same number the page shell uses. */
export type DocumentHighlight = StripHighlight & { page: number };

/** Marks stored on the document, or none when the list is empty or unreadable. */
export function parseDocumentHighlights(raw: string | null | undefined): DocumentHighlight[] {
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
    const mark = item as Record<string, unknown>;
    if (typeof mark.page !== "number" || !Number.isInteger(mark.page) || mark.page < 1) return [];
    if (!isFiniteNumber(mark.x0) || !isFiniteNumber(mark.x1) || !isFiniteNumber(mark.y)) return [];
    if (!isFiniteNumber(mark.size) || mark.size <= 0) return [];
    return [{ page: mark.page, x0: mark.x0, x1: mark.x1, y: mark.y, size: mark.size }];
  });
}

/** The list the document stores. Rounded so a repaint does not rewrite the rows. */
export function serializeDocumentHighlights(marks: readonly DocumentHighlight[]): string {
  return JSON.stringify(
    marks.map((mark) => ({
      page: mark.page,
      x0: roundPt(mark.x0),
      x1: roundPt(mark.x1),
      y: roundPt(mark.y),
      size: roundPt(mark.size),
    })),
  );
}

/** The list the strip stores. Rounded so a repaint does not rewrite the row. */
export function serializeHighlights(marks: StripHighlight[]): string {
  return JSON.stringify(
    marks.map((mark) => ({
      x0: roundPt(mark.x0),
      x1: roundPt(mark.x1),
      y: roundPt(mark.y),
      size: roundPt(mark.size),
    })),
  );
}

/** CSS pixels of the preview per PDF point. */
export function previewScale(cssWidth: number, pageWidth: number): number {
  const safePage = pageWidth > 0 ? pageWidth : 1;
  return cssWidth > 0 ? cssWidth / safePage : 1;
}

/**
 * Where a click landed, in the page's own layout pixels.
 *
 * The preview swells under the pointer, so the box on screen is not the box the
 * marks are laid out in. The ratio of the two puts the click back into the
 * unscaled page, which is the space the marks use.
 */
export function layoutPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  layoutWidth: number,
  layoutHeight: number,
): { x: number; y: number } {
  const width = rect.width > 0 ? rect.width : 1;
  const height = rect.height > 0 ? rect.height : 1;
  return {
    x: ((clientX - rect.left) / width) * layoutWidth,
    y: ((clientY - rect.top) / height) * layoutHeight,
  };
}

/** A layout-pixel point on the preview, as PDF points on the page. */
export function pointOnBand(localX: number, localY: number, bandTop: number, scale: number): PagePoint {
  const safe = scale > 0 ? scale : 1;
  return { x: localX / safe, y: bandTop + localY / safe };
}

/**
 * The horizontal stroke from `anchor` to `endX`.
 *
 * `endX` is where the drag was released. The line stays at the press's `y`, so
 * the mark cannot tilt. A drag that barely moved is not a mark.
 */
export function horizontalMark(anchor: PagePoint, endX: number, size: number): StripHighlight | null {
  if (Math.abs(endX - anchor.x) < MIN_SPAN_PT) return null;
  return { x0: anchor.x, x1: endX, y: anchor.y, size };
}

/**
 * The highlight yellow, painted opaque.
 *
 * Overlapping strokes are the same pixels of this one colour, so a second stroke
 * does not darken the first. The page then multiplies by that one layer, which
 * is what makes the yellow sit in the paper instead of floating on top of it.
 */
export const HIGHLIGHT_FILL = "#fff44f";

/** Where a saved mark sits on the preview, or null when it has no width. */
export function highlightBox(
  mark: StripHighlight,
  band: { top: number; page_width: number },
  cssWidth: number,
): HighlightBox | null {
  const scale = previewScale(cssWidth, band.page_width);
  const width = Math.abs(mark.x1 - mark.x0) * scale;
  if (width < 0.5) return null;
  return {
    left: Math.min(mark.x0, mark.x1) * scale,
    top: (mark.y - band.top) * scale,
    width,
    height: mark.size * scale,
  };
}

/** Every mark that has a width, in the same pixel space as `widthPx`. */
export function highlightBoxes(
  marks: readonly StripHighlight[],
  band: { top: number; page_width: number },
  widthPx: number,
): HighlightBox[] {
  return marks.flatMap((mark) => {
    const box = highlightBox(mark, band, widthPx);
    return box ? [box] : [];
  });
}

/**
 * How far past a mark's edge a press still counts as on it, in CSS pixels.
 *
 * A length on screen rather than on the page, so a stroke's edge answers the
 * same way at every zoom: a right-click just beside the yellow is still a
 * right-click on the stroke, which is what makes a thin one easy to hit.
 */
export const MARK_HIT_SLACK_PX = 10;

/**
 * The mark under a point, as its index in `marks`, or null on bare paper.
 *
 * `point` is in PDF points with `y` from the top of the page — the same space
 * the marks are stored in. `slack` widens every box, in points, so a press near
 * an edge still lands. Later marks win where two overlap: the newest stroke is
 * painted last, so it is the one on top.
 */
export function markAtPoint(
  marks: readonly StripHighlight[],
  point: PagePoint,
  slack = 0,
): number | null {
  for (let index = marks.length - 1; index >= 0; index -= 1) {
    const mark = marks[index];
    if (!mark) continue;
    const left = Math.min(mark.x0, mark.x1);
    const right = Math.max(mark.x0, mark.x1);
    if (point.x < left - slack || point.x > right + slack) continue;
    if (point.y < mark.y - slack || point.y > mark.y + mark.size + slack) continue;
    return index;
  }
  return null;
}

/**
 * Fill `boxes` with one yellow.
 *
 * Each rectangle is the same opaque colour, so where two of them cross the
 * pixel is painted twice with the same value and does not get darker.
 */
export function fillMergedHighlights(context: CanvasRenderingContext2D, boxes: readonly HighlightBox[]): void {
  context.fillStyle = HIGHLIGHT_FILL;
  for (const box of boxes) {
    if (box.width <= 0 || box.height <= 0) continue;
    context.fillRect(box.left, box.top, box.width, box.height);
  }
}

/**
 * Lay the marks onto a page that is already painted.
 *
 * The shapes are flattened on their own canvas first, then multiplied onto the
 * page once. Drawing each rectangle on its own would multiply twice where they
 * cross and turn that spot a darker yellow.
 */
export function paintHighlightsOnPage(
  canvas: HTMLCanvasElement,
  marks: readonly StripHighlight[],
  band: { top: number; page_width: number },
): void {
  const boxes = highlightBoxes(marks, band, canvas.width);
  if (boxes.length === 0) return;
  const layer = document.createElement("canvas");
  layer.width = canvas.width;
  layer.height = canvas.height;
  const layerContext = layer.getContext("2d");
  const pageContext = canvas.getContext("2d");
  if (!layerContext || !pageContext) return;
  fillMergedHighlights(layerContext, boxes);
  pageContext.save();
  // The page render shifts this context so the band sits at y = 0, and it may
  // leave that shift in place. Marks are already in canvas pixels.
  pageContext.setTransform(1, 0, 0, 1, 0, 0);
  pageContext.globalAlpha = 1;
  pageContext.globalCompositeOperation = "multiply";
  pageContext.drawImage(layer, 0, 0);
  pageContext.restore();
}

/**
 * The brush the pointer is showing.
 *
 * The pointer is the top-left corner: that is the press that starts the mark.
 * Before the drag a short thin stub grows right and down from there, so the
 * start is the pointer and not the middle of a block. During the drag, the
 * stroke keeps that top edge and runs from the press to the pointer.
 */
export function brushPreviewBox(
  cursorX: number,
  cursorY: number,
  anchor: PagePoint | null,
  brushPt: number,
  bandTop: number,
  scale: number,
): HighlightBox {
  const height = Math.max(brushPt * (scale > 0 ? scale : 1), 1);
  if (!anchor) {
    return { left: cursorX, top: cursorY, width: BRUSH_LEAD_PX, height };
  }
  const safe = scale > 0 ? scale : 1;
  const x0 = anchor.x * safe;
  const y = (anchor.y - bandTop) * safe;
  return {
    left: Math.min(x0, cursorX),
    top: y,
    width: Math.max(Math.abs(cursorX - x0), 1),
    height,
  };
}

function roundPt(value: number): number {
  return Math.round(value * 100) / 100;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/* ── The one preview that currently owns `[` / `]` and Escape ─────────────── */

type HighlightSession = {
  id: number;
  onBrush: (size: number) => void;
  onEscape: () => void;
  /** Another preview took the pen. This one puts it down. */
  onClose: () => void;
};

let brushPt = DEFAULT_BRUSH_PT;
let session: HighlightSession | null = null;
const sessionListeners = new Set<() => void>();
const brushListeners = new Set<(size: number) => void>();

function emitHighlightSession(): void {
  for (const listener of sessionListeners) listener();
}

/** The preview that currently holds the pen, or null when every pen is up. */
export function highlightSessionId(): number | null {
  return session?.id ?? null;
}

/** Hear when a pen is armed or put down. The snapshot is `highlightSessionId`. */
export function subscribeHighlightSession(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export function currentBrush(): number {
  return brushPt;
}

/**
 * Set the thickness, in PDF points, and tell every pen.
 *
 * The bracket keys and both sliders come through here. A pen cannot redraw its
 * cursor from a render: the stub is written from pointer events, so a change in
 * size has to reach it directly or the cursor keeps the old thickness until the
 * pointer is moved again. The listeners are what draw it again in place.
 */
export function setBrushSize(size: number): number {
  const next = clampBrush(size);
  if (next === brushPt) return brushPt;
  brushPt = next;
  for (const listener of brushListeners) listener(brushPt);
  return brushPt;
}

/** Hear every brush change, so a cursor on screen can be laid out again. */
export function subscribeBrush(listener: (size: number) => void): () => void {
  brushListeners.add(listener);
  return () => {
    brushListeners.delete(listener);
  };
}

/**
 * Arm `next`, or drop the session when the preview that armed it goes away.
 *
 * Only one preview holds the pen. Arming a second one asks the first to close,
 * and a preview that is closing must not clear a session that is no longer its
 * own — that is the one the second preview just armed.
 */
export function setHighlightSession(next: HighlightSession): void {
  if (session && session.id !== next.id) session.onClose();
  const changed = session?.id !== next.id;
  session = next;
  if (changed) emitHighlightSession();
}

export function releaseHighlightSession(id: number): void {
  if (session?.id !== id) return;
  session = null;
  emitHighlightSession();
}

type HighlightKey = {
  key: string;
  code: string;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  target?: EventTarget | null;
};

/**
 * Handle a key for the armed preview. True when the press was the brush or
 * Escape, so the caller can keep it from also resizing the reading strip or
 * closing a column.
 *
 * A field keeps the key: brackets are typed, and Escape cancels the edit.
 * The note dialog keeps it too, because Escape there cancels the note.
 */
export function highlightSessionKey(event: HighlightKey): boolean {
  if (!session) return false;
  if (typingTarget(event.target) || noteDialogOpen()) return false;
  if (event.key === "Escape") {
    session.onEscape();
    return true;
  }
  const direction = bracketDirection(event);
  if (direction === null) return false;
  const next = setBrushSize(brushPt + direction * brushStep(event));
  session.onBrush(next);
  return true;
}

function bracketDirection(event: { key: string; code: string }): -1 | 1 | null {
  if (event.code === "BracketRight" || event.key === "]") return 1;
  if (event.code === "BracketLeft" || event.key === "[") return -1;
  return null;
}

function typingTarget(target: EventTarget | null | undefined): boolean {
  if (typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  // A range is the brush slider. Brackets still change its value; a text field
  // keeps them because `[` is a character there.
  if (target.tagName === "INPUT") return (target as HTMLInputElement).type !== "range";
  return target.closest(".monaco-editor") !== null;
}

function noteDialogOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(".note-backdrop") !== null;
}
