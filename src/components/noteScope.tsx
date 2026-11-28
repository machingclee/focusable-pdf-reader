/**
 * What a note's markdown is being rendered *inside*, and what a click on one of
 * its references may ask for.
 *
 * Two references can appear in a note's markdown — `[note:<id>]`, which is
 * another note's card, and `[annotation:<id>]`, which is text pinned to a PDF —
 * and each needs the same three things from its host:
 *
 *  - the chain of ids the render is already inside, so a note that points back at
 *    one above it, or at itself, is drawn as a line of text instead of being
 *    followed for ever;
 *  - the document being read, so a reference into the same PDF leaves its name out
 *    of the caption;
 *  - the handler that turns a click into "show me that" — a list reveals a card, a
 *    viewer opens a window — or nothing at all where no host can answer, and then
 *    a reference is only read.
 *
 * This lives in its own module, away from `NoteReference`, because two components
 * need it and one of them is the thing a note reference's components map is built
 * from: importing the scope from `NoteReference` would make the annotation chip and
 * the note card import each other.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AnnotationWithDocument, NoteWithDocument } from "../types/dto";

/**
 * Show a referenced note in the list that holds it.
 *
 * The handler belongs to the list, not to the reference component: only a list
 * knows where the referred card is, whether its folder is open, and how to put it
 * on the reading line. Where there is no list — the note popup's preview — there is
 * no handler, and a reference stays a thing to read rather than a thing to press.
 */
export type NoteReveal = (strip: NoteWithDocument) => void;

/**
 * Scroll a PDF viewer onto the pin a referenced annotation names.
 *
 * One function for every view, because the answer is the same everywhere: the
 * viewer that has that document scrolls itself so the pin sits on the reading
 * line — a fifth of the way down the page area — and rings it once. A window is
 * opened only when no viewer has the document. Null where the host has no viewer.
 */
export type AnnotationReveal = (annotation: AnnotationWithDocument) => void;

export type NoteScope = {
  /**
   * The ids this render is already inside, outermost first. A reference to one of
   * them is not followed.
   */
  chain: readonly number[];
  /**
   * The document the note being read belongs to, when the host knows it. A
   * reference into the same PDF leaves the document name out of its caption.
   */
  pdfDocumentId: number | null;
  /** How to show a referenced note in its list, or null where no list can answer. */
  revealNote: NoteReveal | null;
  /** How to show the PDF a referenced annotation points at, or null. */
  revealAnnotation: AnnotationReveal | null;
  /**
   * Write a dragged width back onto a `[note:<id>]` in the note being rendered, or
   * drop it when `width` is null.
   *
   * The handler belongs to that note: a nested note's width is a property of the
   * reference, which lives in the remark that contains it. Null where the remark
   * cannot be written — the card is then only read at the width it already has.
   */
  resizeNote: ((id: number, width: number | null) => void) | null;
};

export const NoteScopeContext = createContext<NoteScope>({
  chain: [],
  pdfDocumentId: null,
  revealNote: null,
  revealAnnotation: null,
  resizeNote: null,
});

/** What the note being rendered is inside of. */
export function useNoteScope(): NoteScope {
  return useContext(NoteScopeContext);
}

/**
 * Mark the markdown inside as belonging to one note.
 *
 * Every renderer of a note's markdown wraps it in this: `MarkdownNote` in a card,
 * `MarkdownPreviewer` in the popup, and `NoteReference` for the markdown of the
 * note a reference points at. `noteId` is what makes a self-reference — or a pair
 * of notes pointing at each other — stop after one level; `pdfDocumentId` is what
 * lets a reference stay quiet about a document the reader is in; the two reveal
 * handlers are what turn a click on a reference into a move to the thing it names,
 * and are inherited by every level below the level that supplied them.
 */
export function NoteScopeProvider({
  noteId = null,
  pdfDocumentId = null,
  revealNote = null,
  revealAnnotation = null,
  resizeNote = null,
  children,
}: {
  noteId?: number | null;
  pdfDocumentId?: number | null;
  revealNote?: NoteReveal | null;
  revealAnnotation?: AnnotationReveal | null;
  resizeNote?: ((id: number, width: number | null) => void) | null;
  children: ReactNode;
}) {
  const outer = useContext(NoteScopeContext);
  const value = useMemo<NoteScope>(() => {
    const chain =
      noteId === null || outer.chain.includes(noteId) ? outer.chain : [...outer.chain, noteId];
    return {
      chain,
      pdfDocumentId: pdfDocumentId ?? outer.pdfDocumentId,
      revealNote: revealNote ?? outer.revealNote,
      revealAnnotation: revealAnnotation ?? outer.revealAnnotation,
      resizeNote: resizeNote ?? outer.resizeNote,
    };
  }, [noteId, pdfDocumentId, outer, revealNote, revealAnnotation, resizeNote]);

  return <NoteScopeContext.Provider value={value}>{children}</NoteScopeContext.Provider>;
}
