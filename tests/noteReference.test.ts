import { describe, expect, test } from "bun:test";
import {
  NOTE_REFERENCE_TAG,
  noteReferenceIdOf,
  noteReferenceIsBlock,
  noteReferenceMarkdown,
  rehypeNoteReferences,
  splitNoteReferences,
} from "../src/noteReference";
import type { HastNode } from "../src/markdown/toc";

/** A hast text node. */
function text(value: string): HastNode {
  return { type: "text", value };
}

/** A paragraph holding `children`. */
function paragraph(...children: HastNode[]): HastNode {
  return { type: "element", tagName: "p", properties: {}, children };
}

/** A run the pass must leave alone, with a reference in it to prove it did. */
function element(tagName: string, ...children: HastNode[]): HastNode {
  return { type: "element", tagName, properties: {}, children };
}

/** Run the pass over a root whose children are `children`. */
function pass(...children: HastNode[]): HastNode[] {
  const tree: HastNode = { type: "root", children };
  rehypeNoteReferences()(tree);
  return tree.children ?? [];
}

describe("noteReferenceMarkdown", () => {
  test("writes the reference the renderer reads back", () => {
    expect(noteReferenceMarkdown(12)).toBe("[note:12]");
    expect(splitNoteReferences(noteReferenceMarkdown(12))).toHaveLength(1);
    expect(noteReferenceIdOf(splitNoteReferences(noteReferenceMarkdown(12))[0])).toBe(12);
  });
});

describe("splitNoteReferences", () => {
  test("leaves text with no reference as the one node it came in as", () => {
    expect(splitNoteReferences("just prose")).toEqual([{ type: "text", value: "just prose" }]);
  });

  test("splits the text around a reference and keeps the id", () => {
    const parts = splitNoteReferences("see [note:12] for details");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual(text("see "));
    expect(parts[1]).toMatchObject({ type: "element", tagName: NOTE_REFERENCE_TAG });
    expect(noteReferenceIdOf(parts[1])).toBe(12);
    expect(parts[2]).toEqual(text(" for details"));
  });

  test("reads every reference on a line", () => {
    const parts = splitNoteReferences("[note:1] and [note:23]");
    expect(parts.map((part) => (part.type === "text" ? part.value : noteReferenceIdOf(part)))).toEqual([
      1,
      " and ",
      23,
    ]);
  });

  test("a reference with no text around it is the whole paragraph", () => {
    const parts = splitNoteReferences("[note:7]");
    expect(parts).toHaveLength(1);
    expect(noteReferenceIdOf(parts[0])).toBe(7);
  });

  test("prose that only looks like a reference stays text", () => {
    // The whitespace, the non-numeric id and the zero are all things a reader
    // might type while writing *about* a reference; none names a strip.
    for (const source of ["[note: 12]", "[note:twelve]", "[note:0]", "[note:12x]", "note:12"]) {
      expect(splitNoteReferences(source)).toEqual([{ type: "text", value: source }]);
    }
  });
});

describe("rehypeNoteReferences", () => {
  test("draws a reference alone in a paragraph as its own block", () => {
    const [only] = pass(paragraph(text("[note:5]")));
    expect(only).toMatchObject({ type: "element", tagName: NOTE_REFERENCE_TAG });
    expect(noteReferenceIsBlock(only)).toBe(true);
  });

  test("ignores the whitespace around a lone reference", () => {
    const [only] = pass(paragraph(text("\n  "), text("[note:5]"), text("  \n")));
    expect(noteReferenceIsBlock(only)).toBe(true);
  });

  test("keeps a reference inside a sentence inline, and the paragraph with it", () => {
    const [only] = pass(paragraph(text("see "), text("[note:5]"), text(" for the passage")));
    expect(only.tagName).toBe("p");
    const reference = only.children?.[1];
    expect(reference).toMatchObject({ tagName: NOTE_REFERENCE_TAG });
    expect(noteReferenceIsBlock(reference)).toBe(false);
  });

  test("finds references inside emphasis but not inside code", () => {
    // The emphasis keeps the paragraph: `*[note:4]*` is a styled reference, not a
    // block of its own.
    const [withEm] = pass(paragraph(element("em", text("[note:4]"))));
    expect(withEm.tagName).toBe("p");
    expect(withEm.children?.[0]?.children?.[0]).toMatchObject({ tagName: NOTE_REFERENCE_TAG });

    const fenced = element("pre", element("code", text("[note:4]")));
    const [unchanged] = pass(paragraph(fenced));
    // The paragraph still holds the fence, and the fence still holds its text:
    // a reference shown as code is code being shown.
    expect(unchanged.children?.[0]?.children?.[0]).toEqual(element("code", text("[note:4]")));
  });

  test("does not put a card inside a link", () => {
    const [unchanged] = pass(paragraph(element("a", text("[note:4]"))));
    expect(unchanged.children?.[0]).toEqual(element("a", text("[note:4]")));
  });

  test("leaves an ordinary paragraph alone", () => {
    expect(pass(paragraph(text("no references here")))).toEqual([paragraph(text("no references here"))]);
  });
});

describe("noteReferenceIdOf", () => {
  test("refuses ids an element could not name", () => {
    expect(noteReferenceIdOf(undefined)).toBeNull();
    expect(noteReferenceIdOf({ properties: { "data-note-id": "0" } })).toBeNull();
    expect(noteReferenceIdOf({ properties: { "data-note-id": "abc" } })).toBeNull();
    expect(noteReferenceIdOf({ properties: { "data-note-id": "31" } })).toBe(31);
  });
});
