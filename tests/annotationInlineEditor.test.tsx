/**
 * The box an annotation is changed in, and the numbers that size it.
 *
 * The editor is *inline*: it stands where the writing stands, at the annotation's own
 * corner and width, on a sheet of the page's own white. Two things make that true and
 * are worth pinning down — the height rules in `annotationEditorBox.ts`, which
 * are what keep the opened editor the same size as the words it replaced, and the
 * markup the shell draws, which is what puts those calls *there* rather than beside
 * the pin.
 *
 * Monaco is a lazy chunk and does not mount in a static render, so what is drawn is
 * its fallback: the field holding the same words while the editor is on its way. The
 * pane's own behaviour is Monaco's, and is not this file's to assert.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AnnotationInlineEditor } from "../src/components/annotation/AnnotationInlineEditor";
import { ANNOTATION_FONT_PT, ANNOTATION_LINE_PT, type PageAnnotation } from "../src/annotation";
import {
  ANNOTATION_EDITOR_MIN_LINES,
  annotationEditorFloor,
  annotationEditorHeight,
  annotationEditorLineHeight,
  annotationEditorRoom,
  annotationZoomOfType,
} from "../src/annotationEditorBox";

/** A row as the page draws it: 9 pt of type, 11.5 pt lines. */
const ROW: PageAnnotation = { id: 7, x: 40, y: 120, width: 160, text: "a marginal note" };

describe("annotationEditorBox", () => {
  test("the editor is drawn in the page's own type, at its zoom", () => {
    // The page sets the writing at `--ann-font × --zoom`; the editor reads that back
    // and works in the same units, so 200% zoom is a font size of 2 × 9 px.
    expect(annotationZoomOfType(ANNOTATION_FONT_PT)).toBe(1);
    expect(annotationZoomOfType(ANNOTATION_FONT_PT * 2)).toBe(2);
    // An unmeasurable box falls back to unzoomed type rather than to nothing.
    expect(annotationZoomOfType(Number.NaN)).toBe(1);
    expect(annotationZoomOfType(0)).toBe(1);
  });

  test("a pin written at another size still reports the page's zoom", () => {
    // The page multiplies the pin's own points by the zoom. A 12 pt writing at 150%
    // renders 18 px; the zoom is still 1.5, so the editor takes the room the page
    // has rather than 1.5 times a default it never used.
    expect(annotationZoomOfType(18, 12)).toBe(1.5);
    expect(annotationZoomOfType(12, 12)).toBe(1);
    // The room below the pin follows the same zoom at any size.
    expect(annotationEditorRoom(800, 400, 18, 12)).toBe(600);
  });

  test("the leading is the page's, not a code editor's", () => {
    expect(annotationEditorLineHeight(ANNOTATION_FONT_PT)).toBe(Math.round(ANNOTATION_LINE_PT));
    // 1.5 leading would respace the paragraph the moment the editor opened.
    expect(annotationEditorLineHeight(ANNOTATION_FONT_PT)).toBeLessThan(
      Math.round(ANNOTATION_FONT_PT * 1.5),
    );
    // Zoomed, the line grows with the type (to a whole pixel, so to within one).
    const single = annotationEditorLineHeight(ANNOTATION_FONT_PT);
    expect(
      Math.abs(annotationEditorLineHeight(ANNOTATION_FONT_PT * 2) - single * 2),
    ).toBeLessThanOrEqual(1);
  });

  test("a one-line edge of the page still opens on a couple of lines", () => {
    // A pin on the last line of its page has no room below it. The room is a ceiling,
    // not a measurement, so the floor is what it gets.
    const fontSize = ANNOTATION_FONT_PT;
    const floor = annotationEditorFloor(fontSize);
    expect(floor).toBe(annotationEditorLineHeight(fontSize) * ANNOTATION_EDITOR_MIN_LINES);
    expect(annotationEditorRoom(800, 800, fontSize)).toBe(floor);
    expect(annotationEditorRoom(800, 900, fontSize)).toBe(floor);
    expect(annotationEditorHeight(10, fontSize, floor)).toBe(floor);
  });

  test("the room is the page's own, below the pin, at the page's zoom", () => {
    // Half a page below the pin at 100%: half a page of editor.
    expect(annotationEditorRoom(800, 400, ANNOTATION_FONT_PT)).toBe(400);
    // At 200% that room is twice as many pixels, because everything on the page is.
    expect(annotationEditorRoom(800, 400, ANNOTATION_FONT_PT * 2)).toBe(800);
    // A page whose height was never recorded is a floor, not a crash.
    expect(annotationEditorRoom(0, 100, ANNOTATION_FONT_PT)).toBe(
      annotationEditorFloor(ANNOTATION_FONT_PT),
    );
  });

  test("the frame follows the text, between the floor and the room", () => {
    const fontSize = ANNOTATION_FONT_PT;
    const floor = annotationEditorFloor(fontSize);
    const room = annotationEditorRoom(800, 100, fontSize);
    // Growing text grows the frame…
    expect(annotationEditorHeight(floor + 60, fontSize, room)).toBe(floor + 60);
    // …to a round number…
    expect(annotationEditorHeight(floor + 60.4, fontSize, room)).toBe(floor + 60);
    // …and past the room it stops: the pane scrolls inside it from there.
    expect(annotationEditorHeight(5000, fontSize, room)).toBe(room);
    // A report Monaco has not measured yet is the floor, never a zero-height box.
    expect(annotationEditorHeight(Number.NaN, fontSize, room)).toBe(floor);
  });
});

function renderEditor(
  overrides: Partial<{
    annotation: PageAnnotation;
    pageHeight: number;
    error: string | null;
  }> = {},
): string {
  return renderToStaticMarkup(
    <AnnotationInlineEditor
      annotation={overrides.annotation ?? ROW}
      pageHeight={overrides.pageHeight ?? 800}
      saving={false}
      error={overrides.error ?? null}
      onSave={() => { }}
      onCancel={() => { }}
    />,
  );
}

describe("AnnotationInlineEditor", () => {
  test("it stands in the annotation's own box and holds the row's own words", () => {
    const html = renderEditor();
    expect(html).toContain('class="page-annotation-editor"');
    // The words are the row's, ready to be typed over — an editor that opened empty
    // would look like the annotation had been lost.
    expect(html).toContain("a marginal note");
  });

  test("one sheet stands under it: the field itself paints nothing", () => {
    // The white sheet is the stylesheet's (`.page-annotation-editor`), and the field
    // inside it must stay transparent or it would paint over the sheet's corners and
    // ring. What can be asserted here is that the fallback is a field of that class,
    // and that the box asks the pane for a height rather than imposing one.
    const html = renderEditor();
    expect(html).toContain('class="ann-inline-field"');
    expect(html).toMatch(/--ann-editor-room:\d+px/);
  });

  test("a failed write says why, under the writing it was about", () => {
    const html = renderEditor({ error: "Could not save this annotation." });
    expect(html).toContain('class="ann-inline-error"');
    expect(html).toContain("Could not save this annotation.");
  });
});
