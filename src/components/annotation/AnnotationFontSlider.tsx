/**
 * One pin's type size, as the slider its menu shows.
 *
 * A size is a quantity, so the control is a track and not two items: the reader
 * drags, and the writing is drawn at the number the knob lands on. The range is
 * **centred on the default** — 5 to 13 around 9 — so the middle of the track is the
 * size a new pin is written at, the same distance from smaller as from bigger. The
 * tick under the knob is that middle, which is what makes the default findable
 * again without counting stops.
 *
 * The track follows the hand at once, and so does the page: every step is handed to
 * `onPreview`, because a size the reader cannot see until they let go is a size
 * they are guessing at. The **row** is written once, on the release (`onCommit`):
 * a write per stop would be a dozen undo steps for one drag — which is why every
 * way a drag can end (pointer, mouse, key, losing focus) is a release.
 *
 * Kept in its own file, apart from the menu, so the row can be rendered and read
 * without a portal: the menu is a floating layer, this is the one control it holds.
 */
import { useEffect, useRef, useState } from "react";
import {
  ANNOTATION_FONT_MAX_PT,
  ANNOTATION_FONT_MIN_PT,
  ANNOTATION_FONT_STEP_PT,
  annotationFontPt,
} from "../../annotation";

/** The size as the row says it: the row stores hundredths, the label trims zeros. */
export function annotationFontLabel(fontPt: number): string {
  return `${Number(annotationFontPt(fontPt).toFixed(2))} pt`;
}

export type AnnotationFontSliderProps = {
  /** The size the row holds, in PDF points. */
  fontPt: number;
  /** The knob moved: draw the writing at this size, without writing it yet. */
  onPreview: (fontPt: number) => void;
  /** The knob was let go on this size: keep it on the row. */
  onCommit: (fontPt: number) => void;
};

export function AnnotationFontSlider({ fontPt, onPreview, onCommit }: AnnotationFontSliderProps) {
  const current = annotationFontPt(fontPt);
  /** The size under the hand while the track is being dragged, or null. */
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? current;
  /**
   * The last number under the hand, for the release handlers.
   *
   * A release is read from the element's own value, which is already the dragged
   * one; the ref only keeps a commit from firing twice (pointer, then mouse, then
   * blur) with the same number.
   */
  const last = useRef<number | null>(null);
  last.current = shown;

  // The row catches up with the draft: drop it once the page draws the same number,
  // so the knob does not jump back between the release and the write landing.
  useEffect(() => {
    if (draft !== null && Math.abs(draft - current) < 0.001) setDraft(null);
  }, [current, draft]);

  const commit = () => {
    const value = last.current;
    if (value === null) return;
    // The release is always reported, even when the knob did not move: the caller
    // owns the preview, and this is how it learns the gesture is over.
    onCommit(value);
  };

  return (
    <div className="ann-size">
      <p className="ann-size-head">
        <span>Text size</span>
        <span className="ann-size-value">{annotationFontLabel(shown)}</span>
      </p>
      <div className="ann-size-track">
        {/* The default, marked on the track: the middle of the range is the size a
            new pin is written at. Under the knob, so it never hides it. */}
        <span className="ann-size-tick" aria-hidden />
        <input
          type="range"
          className="ann-size-slider"
          min={ANNOTATION_FONT_MIN_PT}
          max={ANNOTATION_FONT_MAX_PT}
          step={ANNOTATION_FONT_STEP_PT}
          value={shown}
          aria-label="Annotation text size"
          aria-valuetext={annotationFontLabel(shown)}
          onChange={(event) => {
            const next = Number(event.target.value);
            setDraft(next);
            onPreview(next);
          }}
          onPointerUp={commit}
          onMouseUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
      </div>
    </div>
  );
}
