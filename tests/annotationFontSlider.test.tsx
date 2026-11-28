/**
 * The type-size slider's markup: the one control a pin's menu holds.
 *
 * A portal cannot be rendered on the server, so the menu itself is not this file's
 * subject — the track is, which is why it lives apart. What is worth pinning down
 * without a browser: the ends of the range, the step, the number the knob starts
 * at, and the label that says which size that is.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AnnotationFontSlider } from "../src/components/annotation/AnnotationFontSlider";
import {
  ANNOTATION_FONT_MAX_PT,
  ANNOTATION_FONT_MIN_PT,
  ANNOTATION_FONT_PT,
  ANNOTATION_FONT_STEP_PT,
} from "../src/annotation";

const render = (fontPt: number) =>
  renderToStaticMarkup(
    <AnnotationFontSlider fontPt={fontPt} onPreview={() => {}} onCommit={() => {}} />,
  );

describe("AnnotationFontSlider", () => {
  test("the track runs the same distance either side of the default", () => {
    const markup = render(ANNOTATION_FONT_PT);
    expect(markup).toContain(`min="${ANNOTATION_FONT_MIN_PT}"`);
    expect(markup).toContain(`max="${ANNOTATION_FONT_MAX_PT}"`);
    expect(markup).toContain(`step="${ANNOTATION_FONT_STEP_PT}"`);
    // The default is the middle, which is what "centre the default" means on a
    // track: 9 is as far from 5 as it is from 13.
    expect(ANNOTATION_FONT_PT - ANNOTATION_FONT_MIN_PT).toBe(
      ANNOTATION_FONT_MAX_PT - ANNOTATION_FONT_PT,
    );
    // The knob starts there, and the tick marks it.
    expect(markup).toContain(`value="${ANNOTATION_FONT_PT}"`);
    expect(markup).toContain("ann-size-tick");
    expect(markup).toContain("9 pt");
    expect(markup).toContain('aria-label="Annotation text size"');
  });

  test("a row's own size is where the knob starts", () => {
    expect(render(12)).toContain('value="12"');
    expect(render(12)).toContain("12 pt");
    // Half points are the step, so they are said as halves, not as hundredths.
    expect(render(9.5)).toContain('value="9.5"');
    expect(render(9.5)).toContain("9.5 pt");
  });

  test("a stored size outside the range is drawn at the bound", () => {
    const high = render(40);
    expect(high).toContain(`value="${ANNOTATION_FONT_MAX_PT}"`);
    expect(high).toContain(`${ANNOTATION_FONT_MAX_PT} pt`);
    const low = render(2);
    expect(low).toContain(`value="${ANNOTATION_FONT_MIN_PT}"`);
  });
});
