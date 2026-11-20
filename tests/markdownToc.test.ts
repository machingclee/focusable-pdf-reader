import { describe, expect, test } from "bun:test";
import {
  extractHeadingsFromMd,
  fenceLanguage,
  fenceText,
  rehypeHeadingIds,
  slugify,
  type HastNode,
} from "../src/markdown/toc";

describe("slugify", () => {
  test("lowercases and hyphenates, the way the ids are anchored", () => {
    expect(slugify("Getting Started")).toBe("getting-started");
    expect(slugify("  Trailing spaces  ")).toBe("trailing-spaces");
    expect(slugify("a_b c")).toBe("a-b-c");
  });

  test("keeps non-ASCII letters instead of collapsing to nothing", () => {
    // ASCII-only `\w` used to slug Chinese headings to "", which made the
    // contents list query `#` and blank the preview.
    expect(slugify("第一章 併發")).toBe("第一章-併發");
    expect(slugify("Überblick")).toBe("überblick");
  });

  test("falls back to a usable id when punctuation is all there is", () => {
    expect(slugify("***")).toBe("section");
    expect(slugify("")).toBe("section");
  });
});

describe("extractHeadingsFromMd", () => {
  test("reads level, text and id from ATX headings", () => {
    const headings = extractHeadingsFromMd("# One\n\ntext\n\n### Three");
    expect(headings).toEqual([
      { level: 1, text: "One", id: "one" },
      { level: 3, text: "Three", id: "three" },
    ]);
  });

  test("disambiguates repeated headings in document order", () => {
    const headings = extractHeadingsFromMd("# Intro\n## Intro\n# Intro");
    expect(headings.map((heading) => heading.id)).toEqual(["intro", "intro-1", "intro-2"]);
  });

  test("ignores hashes that are not headings", () => {
    // A closing-hash heading, an indented line and a bare `#` must not match.
    expect(extractHeadingsFromMd("## Note ##\n   # Indented\n#\n#hashtag")).toEqual([
      { level: 2, text: "Note ##", id: "note" },
    ]);
  });

  test("returns nothing for a note without headings", () => {
    expect(extractHeadingsFromMd("just prose\n\n- a list")).toEqual([]);
  });
});

describe("rehypeHeadingIds", () => {
  test("stamps ids that match the extractor, including duplicates", () => {
    const tree: HastNode = {
      type: "root",
      children: [
        h(1, "Intro"),
        h(2, "Intro"),
        { type: "element", tagName: "p", properties: {}, children: [text("body")] },
        h(3, "第一章"),
      ],
    };

    rehypeHeadingIds()(tree);

    expect(tree.children?.map((child) => child.properties?.id)).toEqual([
      "intro",
      "intro-1",
      undefined,
      "第一章",
    ]);
  });

  test("leaves an id that markdown already set alone", () => {
    const tree: HastNode = { type: "root", children: [h(1, "Intro")] };
    tree.children![0].properties = { id: "explicit" };
    rehypeHeadingIds()(tree);
    expect(tree.children![0].properties?.id).toBe("explicit");
  });
});

describe("fence helpers", () => {
  test("reads the language tag out of the code element's classes", () => {
    expect(fenceLanguage(code(["language-ts"]))).toBe("ts");
    expect(fenceLanguage(code(["hljs", "lang-bash"]))).toBe("bash");
    expect(fenceLanguage(code(["hljs"]))).toBeNull();
    expect(fenceLanguage(undefined)).toBeNull();
  });

  test("drops the trailing newline the parser adds to fenced text", () => {
    expect(fenceText(code(["language-sh"], "echo hi\n"))).toBe("echo hi");
    expect(fenceText(code([], "a\nb"))).toBe("a\nb");
  });
});

// ── hast fixtures ────────────────────────────────────────────────────────────

function text(value: string): HastNode {
  return { type: "text", value };
}

function h(level: number, label: string): HastNode {
  return { type: "element", tagName: `h${level}`, properties: {}, children: [text(label)] };
}

function code(classes: string[], value = ""): HastNode {
  return {
    type: "element",
    tagName: "code",
    properties: { className: classes },
    children: [text(value)],
  };
}
