/**
 * Focus mode's veil: everything outside the reading strip is covered, and the
 * strip itself is a clear hole with two resize borders.
 *
 * The hole is paint, plus the two borders. A press in the middle reaches the
 * page underneath, so the text in the strip can still be selected; a right-click
 * there is recognised on the stage, not here. The strip is moved with `↑` / `↓`
 * or by parking it on another paragraph — never by dragging the middle, which is
 * the page's own.
 *
 * The band's geometry is written by the layout pass in `App` (the hole rides the
 * page as it scrolls), so this component only draws the box the band sits in and
 * says where its own edges are.
 */
import type { PointerEvent as ReactPointerEvent, RefObject, WheelEvent as ReactWheelEvent } from "react";

export type FocusEdge = "top" | "bottom";

export type FocusOverlayProps = {
  /** The blur the veil wears, in px. */
  blur: number;
  overlayRef: RefObject<HTMLDivElement | null>;
  /** A wheel over the veil is still a scroll of the page. */
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  /** The press that starts a resize of the strip, from one of its borders. */
  onEdgeResize: (edge: FocusEdge) => (event: ReactPointerEvent<HTMLDivElement>) => void;
};

export function FocusOverlay({ blur, overlayRef, onWheel, onEdgeResize }: FocusOverlayProps) {
  return (
    <div
      className="focus-overlay"
      ref={overlayRef}
      onWheel={onWheel}
      style={{ ["--focus-strip-blur" as string]: `${blur}px` }}
    >
      <div className="focus-mask" aria-hidden />
      {/* Two Pages: the clear strip is one page wide. These cover the
      rest of that row, including the facing page. */}
      <div className="focus-mask focus-mask-left" aria-hidden />
      <div className="focus-mask focus-mask-right" aria-hidden />
      <div className="focus-band">
        <div
          className="focus-edge focus-edge-top"
          onPointerDown={onEdgeResize("top")}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize reading strip from top"
        />
        <div
          className="focus-edge focus-edge-bottom"
          onPointerDown={onEdgeResize("bottom")}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize reading strip from bottom"
        />
      </div>
      <div className="focus-mask" aria-hidden />
    </div>
  );
}
