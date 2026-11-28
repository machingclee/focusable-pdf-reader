import { describe, expect, test } from "bun:test";
import {
  ANNOTATION_REFERENCE_TAG,
  annotationReferenceIdOf,
  annotationReferenceIsBlock,
  annotationReferenceMarkdown,
  rehypeAnnotationReferences,
  splitAnnotationReferences,
} from "../src/annotationReference";
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
  rehypeAnnotationReferences()(tree);
  return tree.children ?? [];
}

describe("annotationReferenceMarkdown", () => {
  test("writes the reference the renderer reads back", () => {
    expect(annotationReferenceMarkdown(12)).toBe("[annotation:12]");
    expect(splitAnnotationReferences(annotationReferenceMarkdown(12))).toHaveLength(1);
    expect(annotationReferenceIdOf(splitAnnotationReferences(annotationReferenceMarkdown(12))[0])).toBe(12);
  });
});

describe("splitAnnotationReferences", () => {
  test("leaves text with no reference as the one node it came in as", () => {
    expect(splitAnnotationReferences("just prose")).toEqual([{ type: "text", value: "just prose" }]);
  });

  test("splits the text around a reference and keeps the id", () => {
    const parts = splitAnnotationReferences("see [annotation:12] for details");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual(text("see "));
    expect(parts[1]).toMatchObject({ type: "element", tagName: ANNOTATION_REFERENCE_TAG });
    expect(annotationReferenceIdOf(parts[1])).toBe(12);
    expect(parts[2]).toEqual(text(" for details"));
  });

  test("reads every reference on a line", () => {
    const parts = splitAnnotationReferences("[annotation:1] and [annotation:23]");
    expect(parts.map((part) => (part.type === "text" ? part.value : annotationReferenceIdOf(part)))).toEqual([
      1,
      " and ",
      23,
    ]);
  });

  test("does not grow out of a note reference", () => {
    expect(splitAnnotationReferences("[note:12]")).toEqual([{ type: "text", value: "[note:12]" }]);
  });

  test("ids start at 1 and carry no whitespace", () => {
    expect(splitAnnotationReferences("[annotation:0]")).toEqual([{ type: "text", value: "[annotation:0]" }]);
    expect(splitAnnotationReferences("[annotation: 12]")).toEqual([
      { type: "text", value: "[annotation: 12]" },
    ]);
    expect(splitAnnotationReferences("[annotation:007]")).toEqual([
      { type: "text", value: "[annotation:007]" },
    ]);
  });

  test("a broken bracket stays prose", () => {
    expect(splitAnnotationReferences("[annotation:12")).toEqual([
      { type: "text", value: "[annotation:12" },
    ]);
    expect(splitAnnotationReferences("[annotation:]")).toEqual([{ type: "text", value: "[annotation:]" }]);
  });
});

describe("rehypeAnnotationReferences", () => {
  test("turns a reference in a paragraph into the element", () => {
    const [only] = pass(paragraph(text("see [annotation:4] here")));
    const children = only?.children ?? [];
    expect(children.map((child) => child.type)).toEqual(["text", "element", "text"]);
    expect(annotationReferenceIdOf(children[1])).toBe(4);
  });

  test("a lone reference replaces its paragraph and is marked as a block", () => {
    const [only] = pass(paragraph(text("  [annotation:9]  ")));
    expect(only?.tagName).toBe(ANNOTATION_REFERENCE_TAG);
    expect(annotationReferenceIsBlock(only)).toBe(true);
  });

  test("a reference inside a sentence is not a block", () => {
    const [only] = pass(paragraph(text("as [annotation:9] says"), text(" more")));
    expect(only?.tagName).toBe("p");
    const reference = (only?.children ?? []).find(
      (child) => child.type === "element" && child.tagName === ANNOTATION_REFERENCE_TAG,
    );
    expect(annotationReferenceIsBlock(reference)).toBe(false);
  });

  test("code, pre and links keep their text", () => {
    for (const tagName of ["code", "pre", "a", "script", "style"]) {
      const [only] = pass(element(tagName, text("[annotation:3]")));
      expect(only?.tagName).toBe(tagName);
      expect(only?.children?.[0]).toEqual(text("[annotation:3]"));
    }
  });

  test("a reference nested deeper is still found", () => {
    const [list] = pass(element("ul", element("li", paragraph(text("[annotation:2]")))));
    const item = list?.children?.[0];
    const reference = item?.children?.[0];
    expect(reference?.tagName).toBe(ANNOTATION_REFERENCE_TAG);
    expect(annotationReferenceIdOf(reference)).toBe(2);
    expect(annotationReferenceIsBlock(reference)).toBe(true);
  });

  test("an element that is not a reference is left alone", () => {
    const [only] = pass(paragraph(element("em", text("plain"))));
    expect(only).toEqual(paragraph(element("em", text("plain"))));
  });
});
