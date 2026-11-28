/**
 * The PDF view's second chrome row: everything that acts on the open document.
 *
 * The row is also the window's second drag surface, on the same terms as the
 * title strip above it: `data-tauri-drag-region="deep"` moves the window on a
 * press anywhere in the row that is not a control — the gaps between clusters,
 * the page readout, the zoom percentage. Tauri's handler refuses to drag when
 * the press's path crosses a clickable element, so Open PDF still opens and the
 * steppers still step; see `TitleBar`.
 *
 * Each cluster is a component of its own, and each reads the state it shows from
 * the store and the moves it makes from the viewer's commands. The row itself
 * takes no props: it says only what belongs beside what.
 */
import { OpenDocumentControls } from "./OpenDocumentControls";
import { PageReadout } from "./PageReadout";
import { ScrollHistoryControls } from "./ScrollHistoryControls";
import { MarkupControls } from "./MarkupControls";
import { ZoomControls } from "./ZoomControls";
import { NotesToggle } from "./NotesToggle";

export function PdfToolbar() {
  return (
    <header className="toolbar" data-tauri-drag-region="deep">
      <OpenDocumentControls />
      <PageReadout />
      <ScrollHistoryControls />
      <MarkupControls />
      <ZoomControls />
      <NotesToggle />
    </header>
  );
}
