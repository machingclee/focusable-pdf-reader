/**
 * `[note:<id>]`: how one note points at another.
 *
 * A reference is written into a remark's markdown as plain text — `[note:12]` —
 * rather than as a link, because it is not a URL: it names a row in this app's
 * own database, and it has to keep naming it when the note is read in another
 * document, in the popup, or in a card whose list is not loaded. The renderer
 * resolves it through RTK Query and draws the referenced strip as a nested note.
 *
 * This module owns the syntax and the hast pass that finds it, and nothing else,
 * so the grammar can be asserted in a test without a DOM or a store. The card
 * that a reference becomes lives in `components/NoteReference.tsx`.
 *
 * Why the pass runs on hast and not on the markdown source: a reference is only
 * text until the parser has decided what is code, a link's label or a heading.
 * Working on the parsed tree is what lets a reference inside a fenced block stay
 * literal (it is a `code` node, never a text one) while the same characters in a
 * paragraph become the card.
 */
import type { HastNode } from "./markdown/toc";

/** The custom element the pass emits; react-markdown maps it to a component. */
export const NOTE_REFERENCE_TAG = "note-ref";

/** The attribute the reference's id rides on. */
const ID_PROPERTY = "data-note-id";

/**
 * Whether the reference stood on its own line.
 *
 * A reference alone in a paragraph is a block: the nested note is drawn as a
 * card under the text. One inside a sentence stays a chip, because a card in the
 * middle of a line would break the sentence it sits in.
 */
const BLOCK_PROPERTY = "data-note-block";

/**
 * The syntax, exactly.
 *
 * Digits only, no leading zero and no whitespace inside the brackets: ids start
 * at 1, so `[note:0]` names nothing, and `[note: 12]` is prose the reader typed.
 * Silently turning either into a card would make the rendered note say something
 * the source does not.
 */
const REFERENCE_SOURCE = String.raw`\[note:([1-9]\d*)\]`;

/** What a reference is written as, for the "Copy as reference" item. */
export function noteReferenceMarkdown(id: number): string {
  return `[note:${id}]`;
}

/** The strip id a rendered `<note-ref>` names, or null when the node is not one. */
export function noteReferenceIdOf(node: HastNode | undefined): number | null {
  const raw = node?.properties?.[ID_PROPERTY];
  const id = typeof raw === "string" ? Number.parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Whether the pass marked this reference as standing on its own line. */
export function noteReferenceIsBlock(node: HastNode | undefined): boolean {
  return node?.properties?.[BLOCK_PROPERTY] !== undefined;
}

/**
 * Text split into the text it was and the references in it.
 *
 * Exported for its own sake: the split is the whole of the syntax handling, and
 * a test can read it without a renderer. A string with no reference comes back
 * as the one text node it went in as, so an untouched tree is not rebuilt.
 */
export function splitNoteReferences(text: string): HastNode[] {
  if (!text.includes("[note:")) return [{ type: "text", value: text }];

  const pattern = new RegExp(REFERENCE_SOURCE, "g");
  const parts: HastNode[] = [];
  let position = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (match.index > position) parts.push({ type: "text", value: text.slice(position, match.index) });
    parts.push({
      type: "element",
      tagName: NOTE_REFERENCE_TAG,
      properties: { [ID_PROPERTY]: match[1] },
      // The card resolves the id itself; the element carries no children so
      // nothing in the text can be mistaken for the note's own label.
      children: [],
    });
    position = match.index + match[0].length;
  }
  if (position < text.length) parts.push({ type: "text", value: text.slice(position) });
  return parts;
}

/**
 * Elements whose text is literal: a reference in a fenced block is code being
 * shown, and one in a link's label cannot become a card without a card inside a
 * link.
 */
const LITERAL_TAGS = new Set(["code", "pre", "a", "script", "style"]);

/**
 * Rehype pass: turn every `[note:<id>]` in prose into a `<note-ref>` element.
 *
 * A paragraph that holds nothing but one reference is *replaced* by it, so the
 * card is not a block inside a `<p>`: the reference reads as its own block, and
 * the note text flows around a real element rather than a paragraph pretending to
 * contain one.
 */
export function rehypeNoteReferences() {
  return (tree: HastNode) => {
    if (tree.children) tree.children = transformChildren(tree.children);
  };
}

function transformChildren(children: HastNode[]): HastNode[] {
  const next: HastNode[] = [];
  for (const child of children) {
    if (child.type === "text") {
      next.push(...splitNoteReferences(child.value ?? ""));
      continue;
    }
    next.push(...transformElement(child));
  }
  return next;
}

function transformElement(node: HastNode): HastNode[] {
  if (node.type !== "element" || !node.tagName) return [node];
  if (LITERAL_TAGS.has(node.tagName)) return [node];

  if (node.children) node.children = transformChildren(node.children);

  if (node.tagName !== "p" || !node.children) return [node];
  // Whitespace around a lone reference is the line break the reader typed, not
  // content: it must not stop the paragraph from being just the reference.
  const content = node.children.filter(
    (child) => !(child.type === "text" && (child.value ?? "").trim() === ""),
  );
  if (content.length !== 1) return [node];

  const only = content[0];
  if (only.type !== "element" || only.tagName !== NOTE_REFERENCE_TAG) return [node];

  return [
    {
      ...only,
      properties: { ...(only.properties ?? {}), [BLOCK_PROPERTY]: "true" },
    },
  ];
}
