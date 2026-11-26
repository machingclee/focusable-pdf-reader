/**
 * A note's markdown, rendered compactly for a card.
 *
 * The cards used to show the remark flattened to plain text (`noteSummary`), which
 * meant a note written with bullets, a table or bold emphasis read as one run of
 * prose with the markers stripped. This renders the same markdown the editor sees,
 * so what was written is what the card shows.
 *
 * It is deliberately a narrower pipeline than the popup's previewer: GFM and math,
 * no `rehype-highlight` and no `rehype-raw`. Highlighting pulls highlight.js and
 * its language grammar into whatever bundle this component lands in — and cards
 * live in the app shell, so that would make every launch carry it for a code
 * colour that is unreadable at card size anyway. Raw HTML is left unparsed for the
 * same "don't pay for the rare case" reason, and because a note is user text.
 *
 * A note may point at another note: `[note:<id>]` becomes that strip's card,
 * nested inside this one (`components/NoteReference.tsx`). The pass that finds
 * the syntax needs no parser of its own — it rewrites the tree this pipeline has
 * already built.
 *
 * Kept behind `memo` on the markdown string: a list re-renders on every toast or
 * refresh tick, and re-parsing every note each time is wasted work.
 *
 * Imported lazily by the card list, so the PDF viewer's own bundle does not carry
 * the parser: it arrives the first time a note card renders.
 */
import { memo, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { rehypeNoteReferences } from "../noteReference";
import { ImageResizeProvider } from "../markdown/NoteImage";
import { NoteScopeProvider, noteRefComponents, type NoteReveal } from "./NoteReference";
// KaTeX's stylesheet, which the math in a card needs as much as the popup does.
import "katex/dist/katex.min.css";

const MarkdownNote = memo(
  function MarkdownNote({
    markdown,
    noteId = null,
    pdfDocumentId = null,
    onRevealNote = null,
    onImageWidthChange = null,
    onNoteWidthChange = null,
  }: {
    markdown: string;
    /** The strip this note belongs to, so a reference to it is not followed again. */
    noteId?: number | null;
    /** Its document: a reference inside the same PDF leaves the document out. */
    pdfDocumentId?: number | null;
    /**
     * Show the note a reference points at. A card supplies this, so clicking a
     * nested note moves the list to it; without it a reference is only read.
     */
    onRevealNote?: NoteReveal | null;
    /**
     * A picture in this note was dragged. `cleanPath` is its src without
     * `?width=`. The card writes that width back into the remark.
     */
    onImageWidthChange?: ((cleanPath: string, width: number) => void) | null;
    /**
     * A nested note in this note was dragged, or maximized. The card writes
     * `?width=` onto the `[note:<id>]` reference, or drops it when `width` is
     * null.
     */
    onNoteWidthChange?: ((noteId: number, width: number | null) => void) | null;
  }) {
    const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
    const rehypePlugins = useMemo(() => [rehypeKatex, rehypeNoteReferences], []);
    // The list re-renders far more often than the note changes, and a fresh
    // callback each time would defeat the memo below. The latest handler is
    // read when the drag actually ends.
    const resizeRef = useRef(onImageWidthChange);
    resizeRef.current = onImageWidthChange;
    const onResize = useMemo(
      () => (cleanPath: string, width: number) => resizeRef.current?.(cleanPath, width),
      [],
    );
    const noteResizeRef = useRef(onNoteWidthChange);
    noteResizeRef.current = onNoteWidthChange;
    const onResizeNote = useMemo(
      () => (childId: number, width: number | null) => noteResizeRef.current?.(childId, width),
      [],
    );

    return (
      <NoteScopeProvider
        noteId={noteId}
        pdfDocumentId={pdfDocumentId}
        revealNote={onRevealNote}
        resizeNote={onNoteWidthChange ? onResizeNote : null}
      >
        <ImageResizeProvider onResize={onResize}>
          <div className="notes-card-markdown">
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              rehypePlugins={rehypePlugins}
              components={noteRefComponents}
            >
              {markdown}
            </ReactMarkdown>
          </div>
        </ImageResizeProvider>
      </NoteScopeProvider>
    );
  },
  (prev, next) =>
    prev.markdown === next.markdown &&
    prev.noteId === next.noteId &&
    prev.pdfDocumentId === next.pdfDocumentId &&
    prev.onRevealNote === next.onRevealNote,
);

export default MarkdownNote;
