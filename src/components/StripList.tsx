/**
 * The saved strips of one document.
 *
 * Owns everything about them: the list query, the remark mutation, the delete
 * mutation, the inline editor and the markdown popup. Nothing above it fetches a
 * strip or passes one down — a host only says *which* document is on screen and
 * what to do when the reader asks to see a strip in the viewer.
 *
 * A card is one click target and it opens the strip; double-clicking the note —
 * its text or the meta line under it — edits the remark in place, whether or not
 * a note has been written yet. The context menu holds the markdown popup and
 * delete, so the destructive action stays behind a deliberate gesture.
 *
 * The list also owns a filter field. It is a UI-level narrowing, not a query: the
 * strips are already here, so typing hides the cards whose markdown and
 * highlighted passage do not answer and leaves everything else alone
 * (`noteFilter.ts` holds the rule). A
 * narrowed list is for reading, so its groups are all open and its rows are not
 * draggable — see `StripFolderBoard`.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { apiErrorMessage } from "../store/api/baseApi";
import { noteApi } from "../store/api/noteApi";
import { noteFolderApi } from "../store/api/noteFolderApi";
import { copyTextToClipboard } from "../clipboard";
import { noteReferenceMarkdown } from "../noteReference";
import { formatSavedAt, noteSummary } from "../notesText";
import { filterNotes, noteMatchesQuery, parseNoteQuery } from "../noteFilter";
import { clampNoteEditorHeight } from "../noteEditorHeight";
import type { Note, NoteWithDocument, NoteFolderWithNotes } from "../types/dto";
import { planStripDrop, type StripGroup } from "../stripOrder";
import { cardScrollTop } from "../notesScroll";
import { restartClassAnimation } from "../stripMark";
import { insertAtSelection, pasteInsertion, replaceImageWidth } from "../markdown/noteImages";
import { useMarkdownShortcuts } from "../markdown/useMarkdownShortcuts";
import {
  nextFolderAction,
  openGroup,
  setAllFoldersOpen,
  toggleGroup,
} from "../folderCollapse";
import { StripFolderBoard } from "./StripFolderBoard";
import { StripThumbnail } from "./StripThumbnail";
import { StripContextMenu } from "./StripContextMenu";
import { NewFolderMenu } from "./NewFolderMenu";
import { NotesExportButton } from "./NotesExportButton";

/**
 * How long a card stays marked as "this is the one you asked for".
 *
 * The mark is a way of pointing, not a mode: the reader clicks a note badge to be
 * shown where that note is, and the card has to stop shouting once they have found
 * it. A selected card that stays selected also lies — after a click elsewhere in the
 * list it reads as a second, current selection.
 *
 * A beat longer than the mark's own animation (the `animate-mark` utility, 1.4s — see
 * `src/tailwind.css`), so the card settles at its resting ring and is read that way for
 * a moment before the mark lets go. At the animation's length the ring would disappear
 * exactly as the wobble finished, which read as the click being taken back.
 */
const SELECTION_HOLD_MS = 3000;

/**
 * The class that plays the wobble.
 *
 * It is the Tailwind utility generated from `--animate-mark` in `src/tailwind.css`;
 * the name is written down here because a restart needs to name it on the element
 * (`restartClassAnimation`), and a utility cannot be read back out of a class list.
 * Change one, change both.
 */
const MARK_ANIMATION_CLASS = "animate-mark";

/**
 * The "nothing yet" answers of the two queries, as module constants.
 *
 * A `= []` default in the destructuring makes a fresh array on every render,
 * which would defeat the memoised strip list below (and, through it, every
 * card's memoised markdown). One frozen empty array serves both until the query
 * answers.
 */
const NO_FOLDERS: NoteFolderWithNotes[] = [];
const NO_STRIPS: Note[] = [];

/**
 * The editor's height, from the note it replaced.
 *
 * A floor and a ceiling, kept in `noteEditorHeight.ts` beside the rule the Monaco
 * frame follows — the two stand in for each other, so they have to open at the same
 * size. No measurement (the editor opened from a saved strip rather than a
 * double-click) leaves the stylesheet's own height in charge.
 */
function editorHeight(measured: number | undefined): { height?: string } {
  if (measured === undefined) return {};
  return { height: `${clampNoteEditorHeight(measured)}px` };
}

/**
 * Where the one card editor is shown.
 *
 * The editor is one DOM node for the whole list. This slot claims it while the
 * card is being edited and puts it back in the park on the way out, before the
 * browser paints — so opening a note moves a field that already exists.
 */
function EditorSlot({
  holder,
  park,
}: {
  holder: HTMLDivElement;
  park: { readonly current: HTMLDivElement | null };
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const slot = ref.current;
    if (slot && holder.parentElement !== slot) slot.appendChild(holder);
    return () => {
      const home = park.current;
      if (home && holder.parentElement !== home) home.appendChild(holder);
    };
  }, [holder, park]);
  return <div ref={ref} className="notes-card-editor-slot" />;
}

// The markdown parser is not part of the viewer's bundle; it loads with the first
// note card and is shared by every card after that.
const MarkdownNote = lazy(() => import("./MarkdownNote"));
// Same for the full editor popup.
const MarkdownNoteDialog = lazy(() =>
  import("../markdown/MarkdownNoteDialog").then((module) => ({
    default: module.MarkdownNoteDialog,
  })),
);
// And for the editor that takes the card's place when a note is double-clicked:
// it is the popup's Monaco pane, so it is just as heavy.
const MarkdownNoteEditor = lazy(() =>
  import("../markdown/MarkdownNoteEditor").then((module) => ({
    default: module.MarkdownNoteEditor,
  })),
);

/**
 * The veil shown while the editor chunk (Monaco + KaTeX, several MB) arrives.
 *
 * It owns Escape for that window. The popup itself handles the key once it is up,
 * and the viewer has learned to leave an open popup alone — so without this, a
 * press during the first load would be claimed by nobody and do nothing, which
 * from the reader's side is a cancel key that ignores them.
 */
function NoteDialogLoading({ onCancel }: { onCancel: () => void }) {
  useMarkdownShortcuts({ onEscape: onCancel });
  return (
    <div className="note-backdrop" aria-busy="true">
      <div className="note-loading">Loading the note editor…</div>
    </div>
  );
}

export type StripListProps = {
  /** Which document's strips to show. The query key and nothing else. */
  pdfDocumentId: number;
  /** Its file, for the thumbnails and the popup's band. */
  filePath: string;
  documentName: string;
  /** Shown when this document has no strips at all. */
  emptyMessage: string;
  /**
   * Strip whose remark should open in the inline editor as soon as the list has
   * it. Used right after a strip is saved, so the new note starts in its field.
   */
  pendingEditId?: number | null;
  /** Called once the pending strip has been opened for editing. */
  onPendingEditHandled?: () => void;
  /**
   * Strip a note badge in the viewer asked to see. Its folder opens, its card is
   * selected, and the card is put on the list's reading line — without opening
   * the editor, because the badge is a request to read a note, not to rewrite it.
   */
  revealId?: number | null;
  /** Called once the revealed strip has been found and placed. */
  onRevealHandled?: () => void;
  /**
   * A `[note:<id>]` reference was clicked inside a note: show that note.
   *
   * The list passes it up rather than revealing anything itself, because the
   * answer is a window — a "Notes of this PDF" window for the note's document,
   * with the card marked and scrolled to there — and windows are opened by the
   * window that owns them: the main window, for every view, and over the bridge
   * for the popped-out column.
   */
  onRevealNote?: (strip: NoteWithDocument) => void;
  /** Ask the viewer to park this strip. */
  onOpenStrip: (strip: Note) => void;
  /** Page-level status line, for "note saved" / backend errors. */
  onStatus?: (message: string) => void;
};

type MenuState = { x: number; y: number; strip: Note };
/**
 * The card being edited inline.
 *
 * `height` is the height the *rendered* note had when the editor opened. The card is
 * a column of one thing after another, so an editor of a different height makes the
 * whole list jump under the pointer that just double-clicked; matching it keeps the
 * card where it was and puts the field where the text was read.
 */
type EditState = { id: number; draft: string; height?: number };

export function StripList({
  pdfDocumentId,
  filePath,
  documentName,
  emptyMessage,
  pendingEditId = null,
  onPendingEditHandled,
  revealId = null,
  onRevealHandled,
  onRevealNote,
  onOpenStrip,
  onStatus,
}: StripListProps) {
  const { data: folders = NO_FOLDERS, isLoading, isError, error } = noteFolderApi.endpoints.listFolders.useQuery({
    pdf_document_id: pdfDocumentId,
  });
  // The strips in no folder are not part of the folder list: the board shows them
  // as its own section, and "Move to folder" can put a strip there.
  const { data: unfiled = NO_STRIPS } = noteApi.endpoints.listStrips.useQuery({
    pdf_document_id: pdfDocumentId,
    unfiled: true,
  });
  /**
   * Every strip of the document, folders first.
   *
   * Memoised on the two query results, which are stable between renders (RTK
   * Query hands back the same arrays until the data changes) — the default
   * `NO_FOLDERS`/`NO_STRIPS` above are what keep that true while a query is
   * still loading. A fresh array per render would rebuild every callback that
   * scans the list, and a new callback is a new prop for every card's
   * `MarkdownNote`, which is memoised on its props: the whole list would
   * re-parse its markdown on every keystroke in an editor or tick of a toast.
   */
  const strips = useMemo(
    () => [...folders.flatMap((folder) => folder.notes), ...unfiled],
    [folders, unfiled],
  );
  const [updateStrip] = noteApi.endpoints.updateStrip.useMutation();
  const [removeStrip] = noteApi.endpoints.deleteStrip.useMutation();
  const [createFolder] = noteFolderApi.endpoints.createFolder.useMutation();
  const [renameFolder] = noteFolderApi.endpoints.renameFolder.useMutation();
  const [deleteFolder] = noteFolderApi.endpoints.deleteFolder.useMutation();
  const [reorderFolderList] = noteFolderApi.endpoints.reorderFolders.useMutation();
  const [reorderStripGroups] = noteApi.endpoints.reorderStrips.useMutation();
  /** Where the empty-space menu was asked for, or null when it is closed. */
  const [newFolderAt, setNewFolderAt] = useState<{ x: number; y: number } | null>(null);
  /**
   * Which groups the reader has opened. Empty means every folder is closed, so the
   * column opens as a list of folder names and the one button above it reads "Expand
   * all" — see `folderCollapse.ts`.
   */
  const [open, setOpen] = useState<Set<number | null>>(() => new Set());
  const folderIds = useMemo(() => folders.map((folder) => folder.id), [folders]);
  /**
   * How many notes each folder really holds.
   *
   * While filtering, the board draws the matches and its header counts are result
   * counts, but deleting a folder takes its hidden notes too — the menu that says
   * how many has to know about all of them (see `StripFolderBoard`).
   */
  const stripTotalsByFolder = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.notes.length])),
    [folders],
  );

  /**
   * The filter field's value, and the list it leaves.
   *
   * The field keeps the words as typed — the query parser is what decides what
   * counts as a term — so editing a quote or a trailing space does not rewrite
   * what the reader sees. The filtered lists are what the board draws; `strips`,
   * `folders` and `unfiled` stay the whole document, because saving, moving and
   * revealing a card all have to know about notes the filter is hiding.
   */
  const [noteFilter, setNoteFilter] = useState("");
  const filterTerms = useMemo(() => parseNoteQuery(noteFilter), [noteFilter]);
  const filtering = filterTerms.length > 0;
  const shownNotes = useMemo(
    () => filterNotes(folders, unfiled, filterTerms),
    [folders, unfiled, filterTerms],
  );
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  /**
   * Every group, open: the collapse state a filtered list is read in.
   *
   * A matching card inside a closed folder would be a result the reader asked for
   * and cannot see, so the filter opens every group while it is on. The reader's
   * own `open` set is left untouched underneath, so clearing the filter puts the
   * folders back exactly as they were folded.
   */
  const allGroupsOpen = useMemo(() => {
    const groups = new Set<number | null>(folderIds);
    groups.add(null);
    return groups;
  }, [folderIds]);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  /**
   * The card the reader is on: what a badge asked for, or what was just clicked.
   * Cleared on its own after `SELECTION_HOLD_MS` — see `markSelected`.
   */
  const [selectedId, setSelectedId] = useState<number | null>(null);
  /** The timer that clears it, so a second mark restarts the hold instead of stacking. */
  const selectionTimer = useRef<number | null>(null);
  /**
   * The card elements, by strip id.
   *
   * The wobble is a CSS animation, and a CSS animation only begins where its class
   * was not before. Marking the card that is already marked sets the state to the
   * value it already holds, so React renders nothing, the class never moves, and the
   * animation stays where it finished. The answer is to restart it on the node
   * itself rather than through a render — see `markSelected` and `stripMark.ts`.
   */
  const cardElements = useRef(new Map<number, HTMLDivElement>());

  /**
   * Point at a card for `SELECTION_HOLD_MS`, replacing whatever was pointed at.
   *
   * Every press wobbles, including a press on the card that is already marked: a
   * second press is a second answer, and having it land in silence reads as a broken
   * column. That is why the class is restarted on the DOM node
   * (`restartClassAnimation`) instead of being driven through a render. Rendering it
   * cannot work: the same id renders nothing, and the old trick — clear the id, set
   * it again in a frame callback — hands the browser the class back before its style
   * pass, because a frame's callbacks run *before* its recalculation. The
   * animation-name never leaves, so nothing restarts, and only the first press of a
   * session moved anything.
   *
   * The restart runs here, synchronously inside the press, for the same reason: it
   * has to happen before the frame's style pass, which is exactly where a render or
   * a callback would place it.
   */
  const markSelected = useCallback((id: number | null) => {
    if (selectionTimer.current !== null) window.clearTimeout(selectionTimer.current);
    selectionTimer.current = null;

    setSelectedId(id);
    if (id === null) return;

    const card = cardElements.current.get(id);
    // Absent when the card is not on screen yet — a badge pointing at a note in a
    // closed folder. Nothing is lost: that card mounts already marked, and a class
    // arriving with the element starts the animation by itself.
    if (card) restartClassAnimation(card, MARK_ANIMATION_CLASS);

    selectionTimer.current = window.setTimeout(() => {
      selectionTimer.current = null;
      setSelectedId(null);
    }, SELECTION_HOLD_MS);
  }, []);

  useEffect(
    () => () => {
      if (selectionTimer.current !== null) window.clearTimeout(selectionTimer.current);
    },
    [],
  );
  /**
   * The card that still has to be put on the list's line.
   *
   * A request can arrive before its card exists — the strip's folder may be
   * closed, its rows may still be loading — so the id waits here until the card is
   * on screen, and only then is the scroll done and the request cleared. It is
   * state rather than a ref because a second click on the same badge has to start
   * a second pass, and only a state change can do that.
   */
  const [pendingRevealId, setPendingRevealId] = useState<number | null>(null);
  /** The card element of the pending reveal, for the measuring below. */
  const pendingCardRef = useRef<HTMLDivElement | null>(null);
  /** The frame that is still re-taking the line, if any; see the reveal effect. */
  const settleFrame = useRef<number | null>(null);
  /** The markdown popup's target, or null when it is closed. */
  const [noteTarget, setNoteTarget] = useState<Note | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  /** Off-screen home of the one card editor. The editor is moved out of it to edit. */
  const editorParkRef = useRef<HTMLDivElement>(null);
  /** The node the editor is portaled into. Stable, so Monaco is created once. */
  const [editorHolder] = useState(() => {
    const node = document.createElement("div");
    node.className = "notes-card-editor-holder";
    return node;
  });

  const startEdit = useCallback((strip: Note, height?: number) => {
    setEdit({ id: strip.id, draft: strip.remark, height });
    setMenu(null);
  }, []);

  // Nobody editing: the editor sits in the park, which is where it is created.
  // A card's slot claims the node in its own layout effect, and that effect runs
  // first, so this only catches the node while it is still loose.
  useLayoutEffect(() => {
    const park = editorParkRef.current;
    if (!park || editorHolder.parentElement) return;
    park.appendChild(editorHolder);
  });

  /**
   * Make sure a card a request is about is not hidden by the filter.
   *
   * A badge, a `[note:<id>]` reference and a note that was just saved are all
   * requests to *see* a card, and the filter is a lens that can hide it. Answering
   * such a request with nothing would read as a broken badge, so the filter is
   * cleared — but only when it actually hides that card: a reveal that already
   * matches leaves the reader's filter exactly where it was.
   */
  const clearFilterFor = useCallback((strip: Note) => {
    setNoteFilter((current) => {
      const terms = parseNoteQuery(current);
      if (terms.length === 0 || noteMatchesQuery(strip.remark, terms, strip.text_excerpt)) {
        return current;
      }
      return "";
    });
  }, []);

  /**
   * Ask for one card: open the folder that holds it, select it, and queue the
   * scroll. A closed folder would otherwise swallow the card the request is
   * about, which is exactly the case a list of any size runs into.
   */
  const revealStrip = useCallback(
    (strip: Note) => {
      setOpen((current) => openGroup(current, strip.note_folder_id));
      // The badge marks the card the same way a click does: the wobble is what moves
      // it into view, and the column may be scrolled away from it.
      markSelected(strip.id);
      setPendingRevealId(strip.id);
    },
    [markSelected],
  );

  /**
   * A click on the nested note a `[note:<id>]` reference draws.
   *
   * The list does not answer this one itself, whichever document the note is in:
   * the answer is a "Notes of this PDF" window for that note's document, and a
   * window belongs to the host. Passing the reference up unchanged is what makes
   * the gesture the same from every view — the docked column, the popped-out
   * column and the Dashboard tab all reach the same function.
   */
  const showReferencedNote = useCallback(
    (referenced: NoteWithDocument) => {
      if (onRevealNote) {
        onRevealNote(referenced);
        return;
      }
      const where = referenced.pdf_document?.name;
      onStatus?.(
        where
          ? `That note is in “${where}”. Open that document to see it here.`
          : "That note is in another document.",
      );
    },
    [onRevealNote, onStatus],
  );

  // A strip that was just saved comes back from the API with this id: open it so
  // the note can be typed straight away — and put it on the line while we are here.
  useEffect(() => {
    if (pendingEditId == null) return;
    const strip = strips.find((candidate) => candidate.id === pendingEditId);
    if (!strip) return;
    clearFilterFor(strip);
    revealStrip(strip);
    startEdit(strip);
    onPendingEditHandled?.();
  }, [pendingEditId, strips, revealStrip, startEdit, onPendingEditHandled, clearFilterFor]);

  // A note badge in the viewer: the same card, without the editor.
  useEffect(() => {
    if (revealId == null) return;
    const strip = strips.find((candidate) => candidate.id === revealId);
    if (!strip) return;
    clearFilterFor(strip);
    revealStrip(strip);
    onRevealHandled?.();
  }, [revealId, strips, revealStrip, onRevealHandled, clearFilterFor]);

  /* Put the card a request asked for on the list's line: a fifth of the way down
     the list, so the note is read with the rest of the list below it. A card with
     less than that much content under it stops at the bottom of the list instead
     — `cardScrollTop` is where that fallback lives.

     What is measured is the card's *row*, not the card. The two have the same box —
     a card fills the row, and the row is exactly as tall as the card — but only the
     row is free of the mark: the wobble is a `translate` and a `rotate` on the card,
     and `getBoundingClientRect()` reports the transformed box. Measuring the card
     would feed the animation back into the placement, and this loop runs once a
     frame for a second, so the list would chase the wobble — the card arriving by
     badge would push its own list around, while the same card arrived at by click
     would not, which is the difference a reader sees as "the note version moves
     things". The row never moves, so both arrivals are the same still wobble.

     The dependencies are the commits the card can appear in: the request itself,
     the folder it opens, the selection that re-renders it, and the rows arriving.
     Until the card is on screen this does nothing and stays armed. */
  useEffect(() => {
    if (pendingRevealId == null) return;
    const card = pendingCardRef.current;
    const scroller = card?.closest<HTMLElement>(".notes-strip-scroll");
    if (!card || !scroller) return;
    setPendingRevealId(null);

    // The row the card sits in: the same box, without the mark on it.
    const frame = card.parentElement instanceof HTMLElement ? card.parentElement : card;

    const place = () =>
      cardScrollTop({
        cardTop:
          frame.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop,
        viewportHeight: scroller.clientHeight,
        maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
      });
    let wanted = place();
    scroller.scrollTop = wanted;

    /* A card's snapshot renders a frame or three after it comes into view, and an
       unpainted canvas is much taller than the band it will show, so the list keeps
       changing height under the card for a moment. Keep re-taking the line for a
       second — and stop the instant the reader scrolls anywhere themselves, which
       is what `wanted` is for. */
    const deadline = performance.now() + 1000;
    const settle = () => {
      settleFrame.current = null;
      if (Math.abs(scroller.scrollTop - wanted) > 1) return;
      const next = place();
      if (Math.abs(next - scroller.scrollTop) > 1) scroller.scrollTop = next;
      wanted = next;
      if (performance.now() > deadline) return;
      settleFrame.current = window.requestAnimationFrame(settle);
    };
    settleFrame.current = window.requestAnimationFrame(settle);
  }, [pendingRevealId, open, selectedId, strips]);

  // A frame still settling after the list goes away (or its document changes)
  // would scroll a scroller it no longer owns.
  useEffect(
    () => () => {
      if (settleFrame.current !== null) window.cancelAnimationFrame(settleFrame.current);
    },
    [],
  );

  /* The field that stands in for Monaco grows with its text, exactly as the editor
     does once it arrives — the box is one line taller per Enter either way, so the
     handover is invisible. `height: auto` first, or `scrollHeight` would only ever
     measure the box it is already in. */
  useEffect(() => {
    const field = fieldRef.current;
    if (!field || !edit) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [edit]);

  // Autofocus, caret at the end: the field is opened to be typed in.
  useEffect(() => {
    const field = fieldRef.current;
    if (!edit || !field) return;
    // `preventScroll`: the reveal above decides where the card sits, and the
    // browser's own "scroll the focused field into view" would overrule it.
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, [edit?.id]);

  /** Write a remark; shared by the inline field and the popup. */
  const saveRemark = useCallback(
    async (strip: Note, remark: string) => {
      if (remark === strip.remark) return null;
      try {
        await updateStrip({ id: strip.id, remark }).unwrap();
        onStatus?.(remark.trim() ? "Note saved." : "Note cleared.");
        return null;
      } catch (cause) {
        return apiErrorMessage(cause) ?? "Could not save that note.";
      }
    },
    [onStatus, updateStrip],
  );

  const commitEdit = useCallback(async () => {
    if (!edit) return;
    const strip = strips.find((candidate) => candidate.id === edit.id);
    const draft = edit.draft;
    setEdit(null);
    if (!strip) return;
    const failure = await saveRemark(strip, draft);
    if (failure) onStatus?.(failure);
  }, [edit, onStatus, saveRemark, strips]);

  // One identity for the life of the list. The editor is created once, and a new
  // onChange on every keystroke makes Monaco re-subscribe and re-lay-out.
  const onDraft = useCallback((draft: string) => {
    setEdit((current) => (current ? { ...current, draft } : current));
  }, []);
  const commitEditRef = useRef(commitEdit);
  commitEditRef.current = commitEdit;
  const saveEdit = useCallback(() => {
    void commitEditRef.current();
  }, []);
  const cancelEdit = useCallback(() => setEdit(null), []);

  const commitDialog = useCallback(
    async (remark: string) => {
      if (!noteTarget) return;
      setNoteSaving(true);
      setNoteError(null);
      const failure = await saveRemark(noteTarget, remark);
      setNoteSaving(false);
      if (failure) {
        setNoteError(failure);
        return;
      }
      setNoteTarget(null);
    },
    [noteTarget, saveRemark],
  );

  const remove = useCallback(
    async (strip: Note) => {
      try {
        await removeStrip(strip.id).unwrap();
        onStatus?.(`Deleted the page ${strip.page_number} strip.`);
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not delete that strip.");
      }
    },
    [onStatus, removeStrip],
  );

  /**
   * Put `[note:<id>]` on the clipboard.
   *
   * The reference is text because that is what a markdown note can hold: pasted
   * into any note, the renderer draws this strip inside it. The menu closes
   * first — a clipboard write takes a moment, and a menu hanging over the list
   * while it happens reads as a stuck menu.
   */
  const copyReference = useCallback(
    async (strip: Note) => {
      setMenu(null);
      const reference = noteReferenceMarkdown(strip.id);
      const copied = await copyTextToClipboard(reference);
      onStatus?.(
        copied
          ? `Copied ${reference} — paste it into a note to point at this one.`
          : "Could not copy the reference to the clipboard.",
      );
    },
    [onStatus],
  );

  /** Make a folder from the empty-space menu, which has already taken its name. */
  const addFolder = useCallback(
    async (name: string) => {
      setNewFolderAt(null);
      try {
        await createFolder({ pdf_document_id: pdfDocumentId, name }).unwrap();
        onStatus?.(`Added the folder "${name}".`);
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not add that folder.");
      }
    },
    [createFolder, onStatus, pdfDocumentId],
  );

  /**
   * Right-click on the column's empty space.
   *
   * Cards and folder headers answer right-clicks themselves, so anything else in
   * the column — the gap between cards, the space below the last one, the empty
   * document — is where a new folder can be made.
   */
  const onEmptySpaceContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target;
    // Fields keep the native menu — copy and paste is what a right-click in one
    // is for — and so does the filter row around the filter's own field.
    if (
      target instanceof Element &&
      target.closest(".notes-card, .notes-folder-head, .notes-filter, input, textarea")
    ) {
      return;
    }
    event.preventDefault();
    setNewFolderAt({ x: event.clientX, y: event.clientY });
  }, []);

  const rename = useCallback(
    async (id: number, name: string) => {
      try {
        await renameFolder({ id, name }).unwrap();
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not rename that folder.");
      }
    },
    [onStatus, renameFolder],
  );

  const removeFolder = useCallback(
    async (id: number) => {
      // The folder's strips go with it, so the request has to say so: the
      // backend refuses to remove a folder that still holds strips otherwise.
      const folder = folders.find((candidate) => candidate.id === id);
      const stripCount = folder?.notes.length ?? 0;
      try {
        await deleteFolder({ id, with_strips: stripCount > 0 }).unwrap();
        onStatus?.(
          stripCount > 0
            ? `Deleted the folder "${folder?.name ?? id}" and its ${stripCount} strip${stripCount === 1 ? "" : "s"}.`
            : `Deleted the folder "${folder?.name ?? id}".`,
        );
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not delete that folder.");
      }
    },
    [deleteFolder, folders, onStatus],
  );

  /**
   * Move a strip to another folder, or out of every folder.
   *
   * It is the same membership request a drag sends, built by the same planner, so
   * the menu cannot leave the folder lists in a shape the drag could not.
   */
  /** Open or close one group, from its chevron or from a drop into it. */
  const toggleGroupOpen = useCallback((id: number | null) => {
    setOpen((current) => toggleGroup(current, id));
  }, []);

  const expandCollapsedGroup = useCallback((id: number | null) => {
    setOpen((current) => openGroup(current, id));
  }, []);

  const toggleAllFolders = useCallback(() => {
    setOpen((current) =>
      setAllFoldersOpen(current, folderIds, nextFolderAction(folderIds, current) === "expand"),
    );
  }, [folderIds]);

  const moveStrip = useCallback(
    async (strip: Note, targetFolderId: number | null) => {
      setMenu(null);
      const groups = planStripDrop(
        [
          { id: null, note_ids: unfiled.map((item) => item.id) },
          ...folders.map((folder) => ({
            id: folder.id,
            note_ids: folder.notes.map((item) => item.id),
          })),
        ],
        strip.id,
        { type: "folder", id: targetFolderId },
      );
      // No groups means the strip is already there; the menu just closes.
      if (!groups) return;

      try {
        await reorderStripGroups({ pdf_document_id: pdfDocumentId, groups }).unwrap();
        // A strip dropped into a closed folder would look like it vanished.
        expandCollapsedGroup(targetFolderId);
        const target = folders.find((folder) => folder.id === targetFolderId);
        onStatus?.(
          target
            ? `Moved the page ${strip.page_number} strip to "${target.name}".`
            : `Moved the page ${strip.page_number} strip out of its folders.`,
        );
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not move that strip.");
      }
    },
    [expandCollapsedGroup, folders, unfiled, onStatus, pdfDocumentId, reorderStripGroups],
  );

  const reorderFolders = useCallback(
    async (folderIds: number[]) => {
      try {
        await reorderFolderList({ pdf_document_id: pdfDocumentId, note_folder_ids: folderIds }).unwrap();
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not reorder the folders.");
      }
    },
    [onStatus, pdfDocumentId, reorderFolderList],
  );

  const reorderStrips = useCallback(
    async (groups: StripGroup[]) => {
      try {
        await reorderStripGroups({ pdf_document_id: pdfDocumentId, groups }).unwrap();
      } catch (cause) {
        onStatus?.(apiErrorMessage(cause) ?? "Could not reorder the strips.");
      }
    },
    [onStatus, pdfDocumentId, reorderStripGroups],
  );

  const errorMessage = isError ? (apiErrorMessage(error) ?? "Could not load the strips.") : null;

  const renderStrip = (strip: Note) => {
    const editing = edit?.id === strip.id;
    const selected = strip.id === selectedId;
    // The mark moves the card itself, with `translate` and `rotate` only: transforms
    // are the one kind of animation that cannot reflow anything, so the card, its
    // neighbours and the list's height are untouched while it wobbles. One animation,
    // whether a card was clicked or a badge sent the reader to it — a tremble followed
    // by a wobble read as two different animations in a row.
    // The class is the *state* of the mark; a repeat press is restarted on the node
    // by `markSelected`, so this string is what every render agrees the card wears.
    const markAnimation = selected ? ` ${MARK_ANIMATION_CLASS}` : "";
    // The one card a reveal is about: the ref is what the scroll pass measures.
    // A waiting reveal wins (its card may be the one being scrolled to), then an
    // open editor, because that is the card the caret is in.
    const target = strip.id === (pendingRevealId ?? edit?.id ?? selectedId);
    // Plain text only for the tooltip and the "has a note" test; the card
    // itself renders the markdown.
    const summary = noteSummary(strip.remark);
    const hasNote = strip.remark.trim().length > 0;
    const label = summary || strip.text_excerpt || "";
    return (
      <div
        // Two things need this node: the pending reveal, which measures it, and the
        // mark, which is restarted on it (see `markSelected`). A callback rather than
        // the ref object the reveal used, so the same div can serve both.
        ref={(node) => {
          if (node) cardElements.current.set(strip.id, node);
          else cardElements.current.delete(strip.id);
          if (target) pendingCardRef.current = node;
        }}
        className={`notes-card${editing ? " is-editing" : ""}${selected ? " is-selected" : ""
          }${markAnimation}`}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY, strip });
        }}
      >
        <div className="notes-card-open">
          {/* The snapshot leads, the note follows it: that is the order
                      the two are read in, and the strip is what the note is
                      about. The preview owns the open control, so the note is
                      never wrapped in a button that would fight it. */}
          <StripThumbnail
            path={filePath}
            band={strip}
            highlights={strip.highlights}
            title={label || `Page ${strip.page_number}`}
            onOpen={() => {
              // Clicking a card is a selection too: it is the one the reader chose.
              markSelected(strip.id);
              onOpenStrip(strip);
            }}
          />
        </div>

        {editing ? (
              <div className="notes-card-editor">
                {/* The one editor, created when the notes opened, is moved into
                    this slot. Mounting a new Monaco pane here is what flickered
                    the first time a card was opened. */}
                <EditorSlot holder={editorHolder} park={editorParkRef} />
                <div className="notes-card-editor-actions">
                  <button
                    type="button"
                    className="notes-card-save"
                    onClick={() => void commitEdit()}
                  >
                    Save note
                  </button>
                  <button
                    type="button"
                    className="notes-card-cancel"
                    onClick={() => setEdit(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
        ) : (
            /* Everything under the preview is one surface: the note, when there is
               one, and the card's meta line. Double-clicking either of them edits
               the note in place — the meta row is as much "this card's writing" as
               the text above it, and an empty card is the same gesture. */
            <div
              className="notes-card-rest"
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                // The note's own height, so the editor opens at the size the
                // text was read at instead of the fixed 240px the card used
                // to jump to. The meta row has no text of its own to
                // measure, so its double-click measures the note above it —
                // the two open at the same size. An empty note has nothing
                // to measure, and the editor starts at its own floor.
                const note = event.currentTarget.querySelector<HTMLElement>(".notes-card-note");
                const height = note?.getBoundingClientRect().height;
                startEdit(strip, height && height > 0 ? height : undefined);
              }}
              title="Double-click to edit this note"
            >
              <span className={`notes-card-note${hasNote ? "" : " is-muted"}`}>
                {hasNote ? (
                  // The fallback is the flattened text: the card is never
                  // empty while the parser loads.
                  <Suspense fallback={summary}>
                    {/* The card's own strip, so a reference back to it is drawn as a
                        line of text rather than the note eating itself. A reference
                        to *another* note is a way there: clicking it puts that card
                        on the line and marks it. */}
                    <MarkdownNote
                      markdown={strip.remark}
                      noteId={strip.id}
                      pdfDocumentId={pdfDocumentId}
                      onRevealNote={showReferencedNote}
                      onImageWidthChange={(cleanPath, width) => {
                        void saveRemark(strip, replaceImageWidth(strip.remark, cleanPath, width));
                      }}
                    />
                  </Suspense>
                ) : // An unwritten note stays blank. The passage remains on the strip
                // as `text_excerpt`, for anything that needs a fallback.
                null}
              </span>

              <div className="notes-card-foot">
                <span className="notes-card-meta">
                  Page {strip.page_number} · {formatSavedAt(strip.created_at)}
                  {hasNote ? "" : " · no note"}
                </span>
              </div>
            </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="notes-strip-body"
      onContextMenu={onEmptySpaceContextMenu}
      // The list is also where ⌘F lands once its cards have focus: the viewer's
      // own find is the page's, and a press that starts on a note is asking to
      // narrow this list. Fields keep their own editor keys (`Search` has focus
      // of its own), so the press is only claimed outside one.
      onKeyDown={(event) => {
        if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") return;
        const target = event.target;
        if (target instanceof Element) {
          const field = target.closest("input, textarea, [contenteditable='true'], .monaco-editor");
          // A note field, the card's editor or the folder's rename field keeps its
          // own keys. The filter field itself is this shortcut's target, so a press
          // there selects what is already typed.
          if (field && !field.classList.contains("notes-filter-field")) return;
        }
        event.preventDefault();
        event.stopPropagation();
        filterInputRef.current?.focus();
        filterInputRef.current?.select();
      }}
    >
      {isLoading && folders.length === 0 && <p className="notes-message">Loading strips…</p>}
      {errorMessage && <p className="notes-message is-error">{errorMessage}</p>}
      {!isLoading && !errorMessage && !filtering && folders.length === 0 && unfiled.length === 0 && (
        <p className="notes-message">{emptyMessage}</p>
      )}

      {/* One row of list-wide actions: how much is here, the filter, fold it away,
          take it with you. It shows whenever there is anything at all — a document
          whose strips are all unfiled has no folders to count, but still exports.

          The filter sits between the count and the buttons, immediately left of
          "Expand all": it narrows the list those buttons act on, so it belongs in
          their row rather than on a line of its own. It shows whenever there is a
          note to narrow, and stays up while the document has none if a filter is
          still typed, so the field that emptied the list cannot disappear with
          the text still in it.

          While filtering, the count is the filter's answer rather than the
          document's totals, and "Collapse all" goes: every group is open, and the
          button would either do nothing or hide the results. */}
      {(folders.length > 0 || unfiled.length > 0 || filtering) && (
        <div className="notes-folder-tools">
          <span
            className="notes-folder-tools-count"
            role={filtering ? "status" : undefined}
            // A compact "3 / 12", the same shape as the viewer's find count: the
            // tools row is tight, and the words would take room from the field
            // that is being typed in. The sentence stays for the tooltip and for
            // anyone listening rather than looking.
            title={
              filtering
                ? `${shownNotes.matched} of ${shownNotes.total} note${
                    shownNotes.total === 1 ? "" : "s"
                  } match this filter`
                : undefined
            }
            aria-label={
              filtering
                ? `${shownNotes.matched} of ${shownNotes.total} notes match this filter`
                : undefined
            }
          >
            {filtering
              ? `${shownNotes.matched} / ${shownNotes.total}`
              : folders.length > 0
                ? `${folders.length} folder${folders.length === 1 ? "" : "s"}`
                : `${unfiled.length} strip${unfiled.length === 1 ? "" : "s"}`}
          </span>

          {/* The filter field. It narrows the cards already in the list by their
              markdown and by the highlighted passage, which the card itself does
              not show; it does not ask the backend for anything. */}
          {(strips.length > 0 || filtering) && (
            <div
              className="notes-filter"
              title='Every word has to appear in the note or in the highlighted passage; put "quotes" around a phrase to keep its spaces'
              // The box around the field is part of the field: a click on the
              // magnifier or the padding should put the caret in it, not do nothing.
              onClick={() => filterInputRef.current?.focus()}
            >
              <Search size={13} aria-hidden />
              <input
                ref={filterInputRef}
                type="search"
                className="notes-filter-field"
                value={noteFilter}
                placeholder="Filter…"
                aria-label="Filter notes by their markdown or highlighted passage"
                spellCheck={false}
                onChange={(event) => setNoteFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  // Escape empties the field before it reaches the column: a filter
                  // is one gesture away from being undone, and the column's own
                  // Escape is a second, separate step back.
                  event.preventDefault();
                  event.stopPropagation();
                  if (noteFilter.length > 0) setNoteFilter("");
                  else event.currentTarget.blur();
                }}
              />
              {noteFilter.length > 0 && (
                <button
                  type="button"
                  className="notes-filter-clear"
                  title="Clear the note filter"
                  aria-label="Clear the note filter"
                  onClick={() => {
                    setNoteFilter("");
                    filterInputRef.current?.focus();
                  }}
                >
                  <X size={12} aria-hidden />
                </button>
              )}
            </div>
          )}

          <div className="notes-folder-tools-actions">
            {folders.length > 0 && !filtering && (
              <button type="button" className="notes-folder-tools-toggle" onClick={toggleAllFolders}>
                {nextFolderAction(folderIds, open) === "collapse" ? "Collapse all" : "Expand all"}
              </button>
            )}
            <NotesExportButton
              documentName={documentName}
              filePath={filePath}
              // Export what is on screen: a filtered list is the one the reader
              // asked to see, so it is the one that gets written.
              folders={filtering ? shownNotes.folders : folders}
              unfiled={filtering ? shownNotes.unfiled : unfiled}
              onStatus={onStatus}
            />
          </div>
        </div>
      )}

      {/* The filter's own empty state: the document has notes, they just do not
          answer this. It is not the "no strips yet" message, which would tell the
          reader to save a note they can see is already there. */}
      {!isLoading && !errorMessage && filtering && shownNotes.matched === 0 && (
        <p className="notes-message">No notes match the filter — clear it to see them all.</p>
      )}

      {/* A document can have strips but no folders: every strip is in no folder.

          The board sits in a container of its own — the list's pane. Its height is
          the pane's, never its content's, so nothing inside can push the tools row
          or the hint off the bottom edge or grow the tab: a long note and a tall
          band preview are the list's problem to scroll, not the layout's. */}
      {(folders.length > 0 || unfiled.length > 0) &&
        (!filtering || shownNotes.matched > 0) && (
          <div className="notes-strip-scroll">
            <StripFolderBoard
              // A filtered list draws only the matches, with every group open;
              // the unfiltered one draws the document as it is.
              folders={filtering ? shownNotes.folders : folders}
              unfiled={filtering ? shownNotes.unfiled : unfiled}
              open={filtering ? allGroupsOpen : open}
              filtering={filtering}
              stripTotals={stripTotalsByFolder}
              onToggleGroup={toggleGroupOpen}
              onExpandGroup={expandCollapsedGroup}
              onReorderNoteFolders={(folderIds) => void reorderFolders(folderIds)}
              onReorderStrips={(groups) => void reorderStrips(groups)}
              onRenameNoteFolder={(id, name) => void rename(id, name)}
              onDeleteNoteFolder={(id) => void removeFolder(id)}
              renderStrip={renderStrip}
            />
          </div>
        )}

      {menu && (
        <StripContextMenu
          x={menu.x}
          y={menu.y}
          currentFolderId={menu.strip.note_folder_id}
          folders={folders.map((folder) => ({ id: folder.id, name: folder.name }))}
          onMove={(folderId) => void moveStrip(menu.strip, folderId)}
          onCopyReference={() => void copyReference(menu.strip)}
          onClose={() => setMenu(null)}
          onEditMarkdown={() => {
            const strip = menu.strip;
            setMenu(null);
            setNoteError(null);
            setNoteTarget(strip);
          }}
          onDelete={() => {
            const strip = menu.strip;
            setMenu(null);
            void remove(strip);
          }}
        />
      )}

      {noteTarget && (
        <Suspense
          fallback={
            <NoteDialogLoading
              onCancel={() => {
                setNoteTarget(null);
                setNoteError(null);
              }}
            />
          }
        >
          {createPortal(
            <MarkdownNoteDialog
              title={`Edit note · page ${noteTarget.page_number}`}
              subtitle={documentName}
              initialMarkdown={noteTarget.remark}
              stripPreview={{ path: filePath, band: noteTarget, highlights: noteTarget.highlights }}
              noteId={noteTarget.id}
              pdfDocumentId={noteTarget.pdf_document_id}
              onRevealNote={onRevealNote}
              saving={noteSaving}
              error={noteError}
              onCancel={() => {
                if (noteSaving) return;
                setNoteTarget(null);
                setNoteError(null);
              }}
              onSave={(markdown) => void commitDialog(markdown)}
            />,
            document.body,
          )}
        </Suspense>
      )}

      {newFolderAt && (
        <NewFolderMenu
          x={newFolderAt.x}
          y={newFolderAt.y}
          onClose={() => setNewFolderAt(null)}
          onCreate={(name) => void addFolder(name)}
        />
      )}

      {/* The card editor lives here from the moment the notes open, off-screen,
          and a double-click only moves this node into the card. */}
      <div ref={editorParkRef} className="notes-card-editor-park" aria-hidden="true" inert />
      {createPortal(
        <Suspense
          fallback={
            edit ? (
              <textarea
                ref={fieldRef}
                className="notes-card-field"
                style={editorHeight(edit.height)}
                value={edit.draft}
                rows={3}
                placeholder="Markdown note for this strip…"
                onChange={(event) => onDraft(event.target.value)}
                onKeyDown={(event) => {
                  // The same paste the Monaco pane uses, so a picture can land
                  // while that chunk is still loading. The key is taken here: the
                  // webview's paste would not turn an image into markdown.
                  if ((event.metaKey || event.ctrlKey) && event.code === "KeyV") {
                    event.preventDefault();
                    const field = event.currentTarget;
                    const start = field.selectionStart;
                    const end = field.selectionEnd;
                    const current = field.value;
                    const noteId = edit.id;
                    void pasteInsertion().then((text) => {
                      if (!text) return;
                      const next = insertAtSelection(current, start, end, text);
                      setEdit((currentEdit) =>
                        currentEdit?.id === noteId ? { ...currentEdit, draft: next.value } : currentEdit,
                      );
                      requestAnimationFrame(() => {
                        field.selectionStart = next.caret;
                        field.selectionEnd = next.caret;
                      });
                    });
                    return;
                  }
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    saveEdit();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelEdit();
                  }
                }}
              />
            ) : null
          }
        >
          <MarkdownNoteEditor
            value={edit?.draft ?? ""}
            height={edit?.height}
            openId={edit?.id ?? null}
            onChange={onDraft}
            onSave={saveEdit}
            onCancel={cancelEdit}
          />
        </Suspense>,
        editorHolder,
      )}
    </div>
  );
}
