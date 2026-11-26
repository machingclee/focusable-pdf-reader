/**
 * The notes list's own filter: which cards the words in its field keep.
 *
 * This is a UI-level narrowing, not a backend query. Every strip of the document
 * is already in the list — the docks and the Dashboard tab hold the whole document —
 * so the only question is whether a note's markdown answers what was typed, and
 * the answer is cheap enough to recompute on every keystroke.
 *
 * A note matches when **every** term is in it, in any order: typing `strip band`
 * finds the note that mentions both, not every note that mentions either. A term
 * may be quoted (`"exact phrase"`) to keep its spaces, and matching ignores case
 * and how the whitespace was laid out.
 *
 * The text searched is the note *as it reads* — `markdownText`, the same
 * flattening the list's one-line label uses — with the raw markdown as a second
 * chance. The raw pass is what lets a reader search for something the renderer
 * eats (a `snake_case` identifier keeps its underscores, a URL in a link target is
 * still there), while the flattened pass is what finds a word the syntax splits
 * (`**bo**ld` reads as "bold", not as two pieces).
 *
 * The passage the strip was saved over (`text_excerpt`) is searched at the same
 * time. A highlight with no remark is otherwise invisible to the field: the card
 * shows nothing of that passage, but the words are how that card is found. A term
 * may sit in either place.
 *
 * Kept free of React and the DOM so the rule can be tested on its own.
 */
import { markdownText } from "./notesText";
import type { Note, NoteFolderWithNotes } from "./types/dto";

/**
 * Split a field's value into the terms a note has to contain.
 *
 * Whitespace separates terms; double quotes group a phrase, spaces included. An
 * unterminated quote runs to the end of the field rather than being dropped, which
 * is what a reader gets while still typing the closing quote — the list has
 * already narrowed to the phrase instead of flashing back to everything.
 */
export function parseNoteQuery(input: string): string[] {
  const terms: string[] = [];
  let pending = "";
  let quoted = false;

  const commit = () => {
    const term = pending.trim().replace(/\s+/g, " ").toLowerCase();
    if (term.length > 0) terms.push(term);
    pending = "";
  };

  for (const char of input) {
    if (char === '"') {
      commit();
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      commit();
      continue;
    }
    pending += char;
  }
  // An unterminated quote is the half-typed case above: the phrase so far counts.
  commit();
  return terms;
}

/** Case- and whitespace-insensitive, so a phrase matches across a line break. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

/**
 * Does one note contain every term?
 *
 * The remark is searched raw, then the highlighted passage, then the remark as it
 * reads. The passage is plain text, so it is cheaper than flattening and it is
 * the only text a highlight with no remark has. A term may be answered by either
 * place: `band` in the passage and `strip` in the remark is one match. A quoted
 * phrase has to sit wholly in one of them.
 *
 * No terms means no filtering — an empty field keeps the whole list.
 */
export function noteMatchesQuery(
  markdown: string,
  terms: readonly string[],
  excerpt?: string | null,
): boolean {
  if (terms.length === 0) return true;

  const raw = normalize(markdown);
  let missing = terms.filter((term) => !raw.includes(term));
  if (missing.length === 0) return true;

  if (excerpt) {
    const passage = normalize(excerpt);
    missing = missing.filter((term) => !passage.includes(term));
    if (missing.length === 0) return true;
  }

  // Only pay for the flattening when the raw text and the passage did not already
  // answer: most terms are ordinary words, and they are in the markdown as typed.
  const read = normalize(markdownText(markdown));
  return missing.every((term) => read.includes(term));
}

/** The lists to draw, and the two numbers the tools row reports. */
export type FilteredNotes = {
  /** Only the folders that still have a matching note, each with only its matches. */
  folders: NoteFolderWithNotes[];
  /** The matching notes that sit in no folder. */
  unfiled: Note[];
  /** How many notes matched: the size of the two lists above. */
  matched: number;
  /** How many notes the document has, matching or not. */
  total: number;
};

/**
 * Narrow a document's folders and unfiled notes to the ones a filter keeps.
 *
 * A folder with no matching note is left out rather than drawn empty: a heading
 * with nothing under it is not a result, and the reader can already see the
 * document has folders from the tools row. A folder whose notes all match is
 * passed through as the same object, so the board is not handed a new identity for
 * data that did not change.
 *
 * An empty filter returns the inputs themselves — the list is not being narrowed,
 * so nothing should look like it was.
 */
export function filterNotes(
  folders: NoteFolderWithNotes[],
  unfiled: Note[],
  terms: readonly string[],
): FilteredNotes {
  const total =
    folders.reduce((count, folder) => count + folder.notes.length, 0) + unfiled.length;

  if (terms.length === 0) {
    return { folders, unfiled, matched: total, total };
  }

  let matched = 0;
  const keptFolders: NoteFolderWithNotes[] = [];
  for (const folder of folders) {
    const kept = folder.notes.filter((strip) =>
      noteMatchesQuery(strip.remark, terms, strip.text_excerpt),
    );
    if (kept.length === 0) continue;
    matched += kept.length;
    keptFolders.push(
      kept.length === folder.notes.length ? folder : { ...folder, notes: kept },
    );
  }

  const keptUnfiled = unfiled.filter((strip) =>
    noteMatchesQuery(strip.remark, terms, strip.text_excerpt),
  );
  matched += keptUnfiled.length;

  return { folders: keptFolders, unfiled: keptUnfiled, matched, total };
}
