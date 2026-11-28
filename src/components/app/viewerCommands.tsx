/**
 * What the viewer's chrome can ask the viewer to *do*.
 *
 * The store holds what the chrome shows; this holds what it cannot: the moves that
 * are measured against the DOM or write to another window. Opening a document,
 * scrolling to a page, walking the scroll history, fitting the width and raising
 * the notes column all read the scroller's boxes or start a load, so they are not
 * reducers and cannot be dispatched.
 *
 * Provided once by the viewer and read by whichever control needs it, so a button
 * deep in the toolbar can open a document without the twelve levels between it and
 * the scroller having an opinion about that.
 */
import { createContext, useContext } from "react";
import type { PageLayout } from "../../pageLayout";
import type { AnnotationWithDocument, Note, NoteWithDocument } from "../../types/dto";

export type ViewerCommands = {
  /** The desktop picker, or the browser's file input. */
  openPicker: () => void;
  /** A recent, by its library path — the same open the notes list uses. */
  openRecent: (path: string, name?: string) => void;
  /** Put a page's top at the reading line. */
  goToPage: (page: number) => void;
  /** Walk the recorded scroll marks, back or forward. */
  stepScrollHistory: (direction: -1 | 1) => void;
  /**
   * Single / Two Pages. The viewer measures the reader's place first, so the
   * page they are on is put back at the same spot in the window.
   */
  chooseLayout: (layout: PageLayout) => void;
  /** Scale by a factor — one `+` / `−` step. */
  zoomBy: (factor: number) => void;
  /** Scale the page to the width available. */
  fitWidth: () => void;
  /** Arm or put down the highlight pen, sized from the text under the pointer. */
  toggleHighlightPen: (brushPt?: number | null) => void;
  /** Raise the notes column — or, popped out, raise that window. */
  toggleNotesPanel: () => void;
  /** Put the find bar up and focus it. */
  openSearch: () => void;
  /** Stand the band on a saved strip — a card clicked in the notes column. */
  parkStrip: (strip: Note) => void;
  /** A `[note:<id>]` reference was clicked: show that note's document. */
  revealNote: (note: NoteWithDocument) => void;
  /** A `[annotation:<id>]` reference was clicked: scroll onto that pin. */
  revealAnnotation: (annotation: AnnotationWithDocument) => void;
  /** Move the notes column into a window of its own (or raise that window). */
  detachNotes: () => void;
};


const ViewerCommandsContext = createContext<ViewerCommands | null>(null);

export const ViewerCommandsProvider = ViewerCommandsContext.Provider;

/** The viewer's commands. Throws rather than silently doing nothing. */
export function useViewerCommands(): ViewerCommands {
  const commands = useContext(ViewerCommandsContext);
  if (!commands) throw new Error("useViewerCommands must be used inside the viewer");
  return commands;
}
