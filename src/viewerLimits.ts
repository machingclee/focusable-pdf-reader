/**
 * The limits the viewer's own controls obey.
 *
 * They live here rather than in `App` because the controls that read out or
 * clamp against them — the blur slider's range, the zoom steppers' step — are
 * components of their own now, and a control that shows a number has to agree
 * with the code that stores it.
 */

export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 6;
/**
 * Multiplier for one `+` / `-` step. Small on purpose: a fine step reads as a
 * smooth zoom, a coarse one as a jump. 1.1 was the old value.
 */
export const ZOOM_STEP = 1.025;

export const MIN_BLUR = 0;
export const MAX_BLUR = 25;
