/**
 * A note badge per saved strip that carries a remark, on the passage it belongs to.
 *
 * A layer of its own, above the veil: in focus mode the band covers the strip the
 * badge sits on, and a badge under it could not be clicked. Its position is not
 * CSS's to work out — a layer cannot ride the page's own scroll — so every badge
 * registers its element here and `App`'s layout pass places it.
 *
 * One control, two actions: a click shows the note in the notes column, a
 * double-click puts the strip on the page.
 */
import type { MouseEvent as ReactMouseEvent } from "react";
import { StickyNote } from "lucide-react";
import type { Note } from "../../types/dto";
import { noteSummary } from "../../notesText";

export type RemarkLayerProps = {
  /** The strips wearing a badge, in draw order. */
  strips: Note[];
  /** Hand a badge's element to the layout pass, or `null` when it unmounts. */
  registerNode: (id: number, node: HTMLButtonElement | null) => void;
  onRemarkClick: (strip: Note, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onRemarkDoubleClick: (strip: Note) => void;
};

export function RemarkLayer({
  strips,
  registerNode,
  onRemarkClick,
  onRemarkDoubleClick,
}: RemarkLayerProps) {
  return (
    <div className="remark-layer" role="group" aria-label="Remarks of this PDF">
      {strips.map((strip) => (
        <button
          key={strip.id}
          type="button"
          ref={(node) => registerNode(strip.id, node)}
          className="remark-marker"
          title={`Page ${strip.page_number} — ${noteSummary(strip.remark, 140)}\nClick to show it in Notes of this PDF, double-click to put the strip on the page.`}
          aria-label={`Remark on page ${strip.page_number}: ${noteSummary(strip.remark, 60)}. Click to show it in Notes of this PDF, double-click to put the strip on the page.`}
          onClick={(event) => onRemarkClick(strip, event)}
          onDoubleClick={() => onRemarkDoubleClick(strip)}
        >
          {/* The face is what grows under the pointer; the line below it
          must keep the length the strip gave it. */}
          <span className="remark-marker-face">
            <StickyNote size={14} aria-hidden />
          </span>
        </button>
      ))}
    </div>
  );
}
