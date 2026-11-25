/**
 * A picture the reader can resize by dragging.
 *
 * Horizontal and vertical movement both change the width — right or up grows
 * it, left or down shrinks it — and the height follows, so the picture keeps
 * its shape. The ceiling is the image's own pixel width: dragging stops there
 * rather than stretching the file past the size it was saved at. The width is
 * reported on mouse-up so the note can store it as `?width=`.
 */
import { useEffect, useRef, useState } from "react";
import { clampImageWidth } from "./noteImages";

export function ResizableImage({
  src,
  alt,
  initialWidth,
  onWidthChange,
}: {
  src: string;
  alt: string;
  initialWidth?: number;
  onWidthChange?: (width: number) => void;
}) {
  const [width, setWidth] = useState<number | undefined>(initialWidth);
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const startRef = useRef<{ x: number; y: number; w: number } | null>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  // The drag listeners close over the mousedown, so the ceiling they read has
  // to be current even when React has not re-rendered yet.
  const naturalRef = useRef<number | null>(null);

  useEffect(() => {
    setWidth(initialWidth == null ? undefined : clampImageWidth(initialWidth, naturalRef.current));
  }, [initialWidth]);

  const rememberNatural = (image: HTMLImageElement) => {
    if (image.naturalWidth <= 0) return;
    naturalRef.current = image.naturalWidth;
    setNaturalWidth(image.naturalWidth);
  };

  const onHandleMouseDown = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const image = containerRef.current?.querySelector("img");
    if (image) rememberNatural(image);
    // The size on screen, not the stored width. A card clips a picture to the
    // column, and a drag has to start from the pixels the reader is holding.
    const currentWidth = containerRef.current?.getBoundingClientRect().width || width || 300;
    const start = { x: event.clientX, y: event.clientY, w: currentWidth };
    startRef.current = start;

    const dragged = (moveEvent: MouseEvent) =>
      clampImageWidth(start.w + (moveEvent.clientX - start.x) - (moveEvent.clientY - start.y), naturalRef.current);

    const onMove = (moveEvent: MouseEvent) => {
      if (!startRef.current) return;
      setWidth(dragged(moveEvent));
    };
    const onUp = (moveEvent: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (!startRef.current) return;
      const finalWidth = dragged(moveEvent);
      startRef.current = null;
      setWidth(finalWidth);
      // A click that does not move must not rewrite the note.
      if (Math.abs(finalWidth - start.w) >= 1) onWidthChange?.(finalWidth);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const shown = width == null ? undefined : clampImageWidth(width, naturalWidth);
  // No stored width yet: fill the column, but never stretch past the file.
  const styleWidth =
    shown != null ? `${shown}px` : naturalWidth != null && naturalWidth > 0 ? `min(100%, ${naturalWidth}px)` : "100%";

  return (
    // A span, not a div: markdown wraps a picture in <p>, and a div there is
    // invalid. The browser lifts it out of the paragraph and React then loses
    // the node. Width still applies because the class is inline-block.
    <span
      ref={containerRef}
      className={`md-image${hovered ? " is-resizable" : ""}`}
      style={{ width: styleWidth }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseDown={onHandleMouseDown}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      title={hovered ? "Drag to resize" : undefined}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(event) => {
          // Read the element now. The state updater runs on the next render,
          // and by then React has cleared currentTarget.
          const image = event.currentTarget;
          rememberNatural(image);
          const natural = image.naturalWidth;
          setWidth((current) => (current == null ? current : clampImageWidth(current, natural)));
        }}
      />
    </span>
  );
}
