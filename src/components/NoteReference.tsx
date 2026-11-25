/**
 * The note a `[note:<id>]` reference points at.
 *
 * A reference is how one note says "see also that strip": the reader copies it
 * from any note's menu and pastes it into another note's markdown, and this
 * component is what that text becomes — the referenced strip drawn as a nested
 * note: its band of the PDF, its remark when it has one, and its page at the
 * foot. The card is the ordinary note card's shape, so the two read alike; the
 * only difference is the band, which is the reference's own way of saying which
 * passage is meant.
 *
 * Three things make it a component rather than a lookup in the list on screen:
 *
 *  - the note it points at may belong to another document, whose strips are not
 *    loaded here at all, so the id is resolved on its own through RTK Query
 *    (`GET /focusable-strips/:id`);
 *  - the same id is rendered from cards, from the note popup and from the
 *    popped-out window, and RTK Query is what makes those one request and one
 *    cache entry, refreshed by the per-id tag when the note is edited;
 *  - a note can reference one that references it back. There is no cycle to
 *    break in the data, so the chain of ids a render is *inside* is carried down
 *    through a context and a repeated id is drawn as a line of text instead of
 *    being followed again.
 *
 * Where a list is on screen, the reference is also a way there: clicking it asks
 * its host to show that note. In the viewer that is the note badge's own action
 * (`App`'s `openRemark`) — the notes column comes forward, the card's folder
 * opens, and the card is marked and scrolled to; in the Dashboard tab it is the rail
 * selecting the document that holds the note, after which the same reveal
 * happens in the list beside it. The request travels down as
 * `NoteScope.revealNote`; where no list can answer it (the note popup's preview)
 * the handler is absent and a reference is only read.
 *
 * The nested text is rendered with the card pipeline (GFM + math + KaTeX), the
 * same one `MarkdownNote` uses, so a nested note reads identically in a card and
 * in the editor's preview instead of depending on which host drew it.
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { StickyNote } from "lucide-react";
import { focusableStripApi } from "../store/api/focusableStripApi";
import { noteSummary } from "../notesText";
import type { FocusableStripWithDocument } from "../types/dto";
import {
  NOTE_REFERENCE_TAG,
  noteReferenceIdOf,
  noteReferenceIsBlock,
  rehypeNoteReferences,
} from "../noteReference";
import { ImageResizeProvider, NoteImage } from "../markdown/NoteImage";
import { replaceImageWidth } from "../markdown/noteImages";
import type { HastNode } from "../markdown/toc";
import { StripThumbnail } from "./StripThumbnail";
// The math in a nested note needs the same stylesheet the note itself does.
import "katex/dist/katex.min.css";

/* ── The chain of notes being rendered ───────────────────────────────────── */

/**
 * Show a referenced note in the list that holds it.
 *
 * The handler belongs to the list, not to this component: only a list knows
 * where the referred card is, whether its folder is open, and how to put it on
 * the reading line. Where there is no list — the note popup's preview — there is
 * no handler, and a reference stays a thing to read rather than a thing to
 * press.
 */
export type NoteReveal = (strip: FocusableStripWithDocument) => void;

export type NoteScope = {
  /**
   * The ids this render is already inside, outermost first. A reference to one
   * of them is not followed.
   */
  chain: readonly number[];
  /**
   * The document the note being read belongs to, when the host knows it. A
   * reference into the same PDF leaves the document name out of its caption —
   * the reader is already there.
   */
  pdfDocumentId: number | null;
  /** How to show a referenced note in its list, or null where no list can answer. */
  revealNote: NoteReveal | null;
};

const NoteScopeContext = createContext<NoteScope>({
  chain: [],
  pdfDocumentId: null,
  revealNote: null,
});

/** What the note being rendered is inside of. */
export function useNoteScope(): NoteScope {
  return useContext(NoteScopeContext);
}

/**
 * Mark the markdown inside as belonging to one note.
 *
 * Every renderer of a note's markdown wraps it in this: `MarkdownNote` in a
 * card, `MarkdownPreviewer` in the popup, and this file for the markdown of the
 * note a reference points at. `noteId` is what makes a self-reference — or a
 * pair of notes pointing at each other — stop after one level; `pdfDocumentId`
 * is what lets a reference stay quiet about a document the reader is in;
 * `revealNote` is what turns a click on a reference into a move to the note it
 * names, and is inherited by every level below the level that supplied it.
 */
export function NoteScopeProvider({
  noteId = null,
  pdfDocumentId = null,
  revealNote = null,
  children,
}: {
  noteId?: number | null;
  pdfDocumentId?: number | null;
  revealNote?: NoteReveal | null;
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
    };
  }, [noteId, pdfDocumentId, outer, revealNote]);

  return <NoteScopeContext.Provider value={value}>{children}</NoteScopeContext.Provider>;
}

/* ── The card ─────────────────────────────────────────────────────────────── */

/**
 * The component `react-markdown` renders `<note-ref>` with.
 *
 * The id and the block/inline decision travel on the element's properties, which
 * the pass in `noteReference.ts` set: keeping them on the node means the
 * renderer needs no closures of its own, so the components map is a module
 * constant every host can share.
 */
export function NoteReferenceElement({ node }: { node?: unknown }) {
  const element = node as HastNode | undefined;
  const id = noteReferenceIdOf(element);
  if (id === null) return null;
  return <NoteReference id={id} block={noteReferenceIsBlock(element)} />;
}

/**
 * The extra renderers a note's markdown needs. Spread it into `components`.
 *
 * References become the nested card. A pasted picture's `images/` src is
 * resolved here too, so a card and a note inside a note show it. A host that
 * draws the picture itself (the popup preview, which can resize it) overrides
 * `img` after the spread.
 */
export const noteRefComponents = {
  [NOTE_REFERENCE_TAG]: NoteReferenceElement,
  img: NoteImage,
} as unknown as Components;

export function NoteReference({ id, block }: { id: number; block: boolean }) {
  const scope = useNoteScope();
  const repeats = scope.chain.includes(id);
  // Hooks stay unconditional; `skip` is what stops a self-reference from asking
  // the backend for the note that is already being rendered.
  const { data: strip, isLoading, error } = focusableStripApi.endpoints.getStrip.useQuery(id, {
    skip: repeats,
  });

  // A note that references one already on the way down is not followed again:
  // the reader can see it above, and following it would never end.
  if (repeats) {
    return <ReferenceLine block={block}>Note {id} is already open above</ReferenceLine>;
  }

  if (isLoading) return <ReferenceLine block={block}>Note {id}…</ReferenceLine>;

  if (!strip) {
    return isMissing(error) ? (
      <ReferenceLine block={block} tone="missing">
        Note {id} was deleted
      </ReferenceLine>
    ) : (
      <ReferenceLine block={block} tone="error">
        Note {id} could not be loaded
      </ReferenceLine>
    );
  }

  const documentName = strip.pdf_document?.name ?? null;
  const showsDocument = documentName !== null && scope.pdfDocumentId !== strip.pdf_document_id;
  const path = strip.pdf_document?.file_path;
  const hasNote = strip.remark.trim().length > 0;
  // The tooltip is the note flattened to one line: the same label the strip's
  // own card uses, so a reference and the card it points at read alike. A strip
  // with no note has nothing to flatten, and the page's excerpt is not the
  // note — the tooltip names only where the strip is.
  const summary = hasNote ? noteSummary(strip.remark, 140) : "";
  const title = `Page ${strip.page_number}${documentName ? ` of ${documentName}` : ""}${
    summary ? ` — ${summary}` : ""
  }`;
  // Only a host with a list behind it can answer a click. The popup's preview has
  // none, so there a reference stays inert rather than promising a move it cannot
  // make.
  const reveal = scope.revealNote;
  const revealTitle = `${title} — click to show this note`;

  /* A press on something inside the card — a link in the note, a checkbox — is
     that thing's press, not the card's: the reference must not also jump away
     under it. */
  const isOwnControl = (target: EventTarget | null) =>
    target instanceof Element && target.closest("a, button, input, select, textarea") !== null;

  const chipBody = (
    <>
      <StickyNote size={12} aria-hidden />
      <span className="note-ref-chip-page">p.{strip.page_number}</span>
      {showsDocument && <span className="note-ref-chip-doc">{documentName}</span>}
    </>
  );

  if (!block) {
    // In the middle of a sentence: a card would split the sentence it belongs
    // to, so the reference is a small marker naming where the note is.
    return reveal ? (
      <button
        type="button"
        className="note-ref-chip is-revealable"
        title={revealTitle}
        onClick={() => reveal(strip)}
        // The chip sits in a paragraph, and a card's own double-click opens the
        // note editor: one press on a reference is not a press on the note.
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {chipBody}
      </button>
    ) : (
      <span className="note-ref-chip" title={title}>
        {chipBody}
      </span>
    );
  }

  return (
    <NoteScopeProvider noteId={strip.id} pdfDocumentId={strip.pdf_document_id}>
      <article
        className={`note-ref${reveal ? " is-revealable" : ""}`}
        data-note-id={strip.id}
        title={reveal ? revealTitle : title}
        // A card is a block of prose, so it cannot be a <button>; the role says
        // what a press does, and the tab stop is what makes it reachable.
        role={reveal ? "button" : undefined}
        tabIndex={reveal ? 0 : undefined}
        onClick={
          reveal
            ? (event) => {
                if (isOwnControl(event.target)) return;
                reveal(strip);
              }
            : undefined
        }
        onKeyDown={
          reveal
            ? (event) => {
                // Only the card's own press: a key pressed inside the note's text
                // belongs to whatever has focus there.
                if (event.target !== event.currentTarget) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                reveal(strip);
              }
            : undefined
        }
        onDoubleClick={reveal ? (event) => event.stopPropagation() : undefined}
      >
        {path && (
          <span className="note-ref-band">
            <StripThumbnail path={path} band={strip} highlights={strip.highlights} />
          </span>
        )}
        {/* A strip with no note on it is left empty. The band above is the
            passage the reference names, and the page in the footer says where
            it is; the strip's excerpt is the page's text rather than anything
            the reader wrote, so it is not printed in the note's place. */}
        {hasNote && <NoteRefBody stripId={strip.id} markdown={strip.remark} />}
        {/* The page is a footer here, in the same place and the same shape as an
            ordinary note card's meta line: a reference is read after the note it
            names, so its caption ends the card instead of opening it. */}
        <footer className="note-ref-foot">
          <span className="note-ref-meta">
            Page {strip.page_number}
            {showsDocument ? ` · ${documentName}` : ""}
          </span>
        </footer>
      </article>
    </NoteScopeProvider>
  );
}

/** A reference with nothing to draw: still loading, gone, or already above. */
function ReferenceLine({
  block,
  tone = "muted",
  children,
}: {
  block: boolean;
  tone?: "muted" | "missing" | "error";
  children: ReactNode;
}) {
  const className = `note-ref-line is-${tone}`;
  // Block-level when the reference stood alone in its paragraph: a paragraph
  // inside a paragraph is not a thing, and the line is the whole paragraph.
  return block ? (
    <p className={className}>{children}</p>
  ) : (
    <span className={`${className} is-inline`}>{children}</span>
  );
}

/** The markdown of the referenced note, one level down the chain. */
function NoteRefBody({ stripId, markdown }: { stripId: number; markdown: string }) {
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeKatex, rehypeNoteReferences], []);
  const [updateStrip] = focusableStripApi.endpoints.updateStrip.useMutation();
  // A picture here belongs to the referenced note, not the note that points at
  // it, so the drag writes that note's remark.
  const onResize = useCallback(
    (cleanPath: string, width: number) => {
      const remark = replaceImageWidth(markdown, cleanPath, width);
      if (remark === markdown) return;
      void updateStrip({ id: stripId, remark });
    },
    [markdown, stripId, updateStrip],
  );

  return (
    <ImageResizeProvider onResize={onResize}>
      <div className="note-ref-markdown">
        <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={noteRefComponents}>
          {markdown}
        </ReactMarkdown>
      </div>
    </ImageResizeProvider>
  );
}

/** A reference to a strip that is gone answers 404; anything else is a real failure. */
function isMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  return status === 404 || status === "404";
}
