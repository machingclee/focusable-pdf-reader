/**
 * The veil that covers the window while a PDF is being dragged over it.
 *
 * A drop lands wherever it is released, so the veil covers the whole application
 * — the title strip, the toolbar, the page and the notes — rather than only the
 * page: what it promises is that releasing will open the file, wherever the
 * pointer happens to be.
 *
 * Whether it is up is the document slice's; the drag handlers own it.
 */
import { useAppSelector } from "../../store/hooks";
import { selectDropActive } from "../../store/slices/documentSlice";

export function PdfDropVeil() {
  const active = useAppSelector(selectDropActive);
  if (!active) return null;
  return (
    <div className="pdf-drop-veil" role="status">
      <p>Drop to open PDF</p>
    </div>
  );
}
