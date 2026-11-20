/**
 * Heading extraction for the markdown note previewer.
 *
 * Two callers need the same answer to "which headings does this note have":
 * the inline `[TOC]` block, which renders them into the previewed document
 * itself, and the sidebar, which is a plain list of links that scrolls the
 * preview container. Both key off the same ids, so the slug rules live here
 * once, and the rehype pass that stamps ids onto the rendered `<h1..h6>`
 * elements reuses them. Drift between the two would make the sidebar link to
 * anchors that do not exist.
 *
 * Ported from the shell-script-manager project's MarkdownPreviewer, where the
 * same functions were inlined; the item-reference and presentation features
 * they were entangled with are gone, the slug rules are unchanged.
 */

/** The subset of a hast element these passes need. */
export type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: { start?: { line?: number } };
};

export type Heading = {
  /** 1 for `#`, 6 for `######`. */
  level: number;
  /** Raw heading text, markdown inline syntax included. */
  text: string;
  /** Anchor id, unique within one document. */
  id: string;
};

/**
 * GitHub-ish slugifier.
 *
 * `\w` is ASCII-only in JavaScript, so a Chinese heading would otherwise slug
 * to `""` and `querySelector("#")` would throw, blanking the whole preview.
 * `\p{L}\p{N}` keeps every script's letters and digits.
 */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

/** Concatenated text of an element, ignoring inline markup. */
export function extractNodeText(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  if (node.children) return node.children.map(extractNodeText).join("");
  return "";
}

/**
 * Rehype pass: give every heading an `id`, matching what
 * `extractHeadingsFromMd` predicted for the same source. The second `# Intro`
 * becomes `intro-1`, in document order, exactly as the extractor counts it.
 */
export function rehypeHeadingIds() {
  return (tree: HastNode) => {
    const counts: Record<string, number> = {};
    function walk(node: HastNode) {
      if (node.type === "element" && node.tagName && /^h[1-6]$/.test(node.tagName)) {
        const text = extractNodeText(node);
        const slug = slugify(text);
        const count = counts[slug] ?? 0;
        counts[slug] = count + 1;
        node.properties = node.properties ?? {};
        if (!node.properties.id) {
          node.properties.id = count === 0 ? slug : `${slug}-${count}`;
        }
      }
      if (node.children) node.children.forEach(walk);
    }
    walk(tree);
  };
}

/**
 * Line-scanning twin of the remark/rehype pipeline.
 *
 * Reading `#` lines straight from the source is what lets the sidebar exist
 * before the document is parsed, and keeps still-working while the user is
 * mid-edit with a half-typed heading.
 */
export function extractHeadingsFromMd(content: string): Heading[] {
  const headings: Heading[] = [];
  const counts: Record<string, number> = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      const slug = slugify(text);
      const count = counts[slug] ?? 0;
      counts[slug] = count + 1;
      headings.push({ level, text, id: count === 0 ? slug : `${slug}-${count}` });
    }
  }
  return headings;
}

/** Shell/batch blocks the note editor offers to run. Kept out of the previewer. */
export type FenceInfo = { text: string; language: string | null };

/** Concatenated text of a hast subtree, including `raw` HTML nodes. */
export function hastText(node: HastNode | undefined): string {
  if (!node) return "";
  if (node.type === "text" || node.type === "raw") return node.value ?? "";
  if (Array.isArray(node.children)) return node.children.map(hastText).join("");
  return "";
}

/** Fence text without the trailing newline the markdown parser appends. */
export function fenceText(node: HastNode | undefined): string {
  return hastText(node).replace(/\n$/, "");
}

/** `class`/`className` on a hast node, flattened to a plain list. */
export function classNamesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => String(item).split(/\s+/));
  if (typeof value === "string") return value.split(/\s+/);
  return [];
}

/** Language tag of a fenced block, e.g. `ts` for ```ts. */
export function fenceLanguage(node: HastNode | undefined): string | null {
  for (const name of classNamesOf(node?.properties?.className)) {
    const match = name.match(/^(?:language|lang)-(.+)$/);
    if (match) return match[1].toLowerCase();
  }
  return null;
}
