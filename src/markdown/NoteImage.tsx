/**
 * A picture in a rendered note, on a card or inside a note that references
 * another.
 *
 * Dragging resizes it the same way as the markdown preview: right or up grows
 * it, left or down shrinks it, and it cannot be dragged past the file's own
 * pixel size. The host that owns the remark supplies `onResize` and writes
 * `?width=` back.
 */
import { createContext, useContext, type ReactNode } from "react";
import { noteImagePath, noteImageSrc, useImagesDir } from "./noteImages";
import { ResizableImage } from "./ResizableImage";

const ImageResizeContext = createContext<((cleanPath: string, width: number) => void) | null>(null);

/** The remark a picture belongs to. A nested note supplies its own. */
export function ImageResizeProvider({
  onResize,
  children,
}: {
  onResize: (cleanPath: string, width: number) => void;
  children: ReactNode;
}) {
  return <ImageResizeContext.Provider value={onResize}>{children}</ImageResizeContext.Provider>;
}

export function NoteImage({ src, alt }: { src?: string | null; alt?: string | null }) {
  const imagesDir = useImagesDir();
  const onResize = useContext(ImageResizeContext);
  const { cleanPath, width } = noteImagePath(src ?? "");
  return (
    <ResizableImage
      src={noteImageSrc(cleanPath, imagesDir)}
      alt={alt ?? ""}
      initialWidth={width}
      onWidthChange={onResize ? (next) => onResize(cleanPath, next) : undefined}
    />
  );
}
