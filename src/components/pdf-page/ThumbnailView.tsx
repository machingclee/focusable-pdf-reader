/**
 * One page of the pages rail: a button, the page drawn small, its number.
 *
 * Two things keep a long document from rendering itself: the canvas is only
 * started when the thumb comes near the rail's viewport, and it is drawn at the
 * rail's width rather than at the reader's zoom, so a zoom tick never touches
 * the rail. Only the page the counter names scrolls the rail — an automatic
 * scroll on every thumb the reader passes would fight them for the scrollbar.
 */
import { memo, useEffect, useRef, useState } from "react";
import { renderPageToCanvas, type LoadedPage } from "../../pdf";

export const ThumbnailView = memo(function ThumbnailView({
  page,
  active,
  lead = false,
  width,
  onSelect,
}: {
  page: LoadedPage;
  active: boolean;
  /** The page the counter names. Only this thumb scrolls the rail. */
  lead?: boolean;
  width: number;
  onSelect: (index: number) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shouldRender, setShouldRender] = useState(false);
  const scale = width / page.width;
  const cssHeight = page.height * scale;

  useEffect(() => {
    const node = buttonRef.current;
    if (!node) return;
    const root = node.closest(".thumbs");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setShouldRender(true);
      },
      { root: root instanceof Element ? root : null, rootMargin: "480px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldRender) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const task = renderPageToCanvas(page.pdfPage, canvas, scale);
    return () => task.cancel();
  }, [page, scale, shouldRender]);

  useEffect(() => {
    if (!lead) return;
    buttonRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [lead]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={active ? "thumb active" : "thumb"}
      onClick={() => onSelect(page.index)}
      aria-current={lead ? "page" : undefined}
      aria-label={`Go to page ${page.index}`}
    >
      <span className="thumb-shell" style={{ width, height: cssHeight }}>
        <canvas ref={canvasRef} />
      </span>
      <span className="thumb-label">{page.index}</span>
    </button>
  );
});
