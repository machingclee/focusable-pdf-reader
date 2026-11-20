import { describe, expect, test } from "bun:test";
import { buildNotesHtml, escapeHtml, renderNoteMarkdown } from "../src/notesHtml";
import type { FocusableStrip, FolderWithStrips } from "../src/types/dto";

/** A strip with only the fields the export reads filled in. */
function strip(id: number, page: number, remark: string, extra: Partial<FocusableStrip> = {}): FocusableStrip {
  return {
    id,
    pdf_document_id: 1,
    folder_id: null,
    ordering: id,
    page_number: page,
    top: 10,
    height: 40,
    left: 20,
    width: 300,
    page_width: 612,
    page_height: 792,
    text_excerpt: `Excerpt of page ${page}`,
    remark,
    created_at: new Date(2026, 10, 20, 14, 30, 0).getTime(),
    ...extra,
  };
}

function folder(id: number, name: string, strips: FocusableStrip[]): FolderWithStrips {
  return {
    id,
    pdf_document_id: 1,
    name,
    ordering: id,
    created_at: new Date(2026, 10, 19, 9, 0, 0).getTime(),
    focusable_strips: strips,
  };
}

const plain = { documentName: "Deep Work", filePath: "/Users/reader/Books/Deep Work.pdf", generatedAt: 1763800000000 };

describe("escapeHtml", () => {
  test("escapes the five characters that change meaning", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;",
    );
  });

  test("leaves ordinary text alone", () => {
    expect(escapeHtml("Page 12 · Reading notes")).toBe("Page 12 · Reading notes");
  });
});

describe("renderNoteMarkdown", () => {
  test("renders GFM: emphasis, lists and tables", () => {
    const html = renderNoteMarkdown("**bold**\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
  });

  test("renders math through KaTeX", () => {
    expect(renderNoteMarkdown("$x^2 + y^2$")).toContain('class="katex');
  });

  test("highlights fenced code", () => {
    expect(renderNoteMarkdown("```ts\nconst answer = 42;\n```")).toContain('class="hljs');
  });

  test("keeps task-list checkboxes, checked and unchecked", () => {
    const html = renderNoteMarkdown("- [x] done\n- [ ] todo");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });

  test("does not throw on text that looks like broken markdown", () => {
    expect(() => renderNoteMarkdown("![unclosed](")).not.toThrow();
    expect(renderNoteMarkdown("![unclosed](").length).toBeGreaterThan(0);
  });
});

describe("buildNotesHtml", () => {
  test("titles the file after the document and names its source", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "Chapter one", [strip(11, 12, "The strip sits over the intro.")])],
      unfiled: [],
    });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>Deep Work — Notes</title>");
    expect(html).toContain('<h1 class="doc-title">Deep Work</h1>');
    expect(html).toContain("/Users/reader/Books/Deep Work.pdf");
  });

  test("keeps the folders in order, then the strips that are in none", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [
        folder(3, "Methods", [strip(31, 40, "Control group.")]),
        folder(7, "Results", [strip(71, 60, "Faster than expected.")]),
      ],
      unfiled: [strip(90, 5, "Loose thought.")],
    });
    const methods = html.indexOf("Methods");
    const results = html.indexOf("Results");
    const loose = html.indexOf("No folder");
    expect(methods).toBeGreaterThan(-1);
    expect(results).toBeGreaterThan(methods);
    expect(loose).toBeGreaterThan(results);
    expect(html).toContain('id="folder-3"');
    expect(html).toContain('id="group-unfiled"');
    expect(html).toContain('id="strip-90"');
  });

  test("counts strips, notes and folders, and marks the strips without a note", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "Read", [strip(11, 12, "A real note."), strip(12, 13, "   ")])],
      unfiled: [],
    });
    expect(html).toContain("<span>2 strips</span>");
    expect(html).toContain("<span>1 note</span>");
    expect(html).toContain("<span>1 folder</span>");
    expect(html).toContain("no note");
  });

  test("lists an empty folder rather than dropping it", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "Read", []), folder(2, "Later", [strip(21, 3, "Next.")])],
      unfiled: [],
    });
    expect(html).toContain("No strips in this folder.");
    expect(html).toContain('id="folder-1"');
  });

  test("embeds a strip picture when one was painted", () => {
    const picture = "data:image/png;base64,iVBORw0KGgo=";
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "Read", [strip(11, 12, "A real note."), strip(12, 13, "Another.")])],
      unfiled: [],
      thumbnails: new Map([[11, picture]]),
    });
    expect(html).toContain(`<img src="${picture}"`);
    // The strip without a picture still exports its note.
    expect(html.split("<img").length - 1).toBe(1);
    expect(html).toContain("Another.");
  });

  test("shows the excerpt where a strip has no note", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "Read", [strip(11, 12, "", { text_excerpt: "the opening paragraph" })])],
      unfiled: [],
    });
    expect(html).toContain("the opening paragraph");
  });

  test("makes a strip's picture openable on its own", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "Read", [strip(11, 12, "A note.")])],
      unfiled: [],
      thumbnails: new Map([[11, "data:image/png;base64,iVBORw0KGgo="]]),
    });
    // A data URL cannot be navigated to in a tab, so the page carries the code
    // that opens the picture itself — and the cursor that promises the click.
    expect(html).toContain("cursor: zoom-in");
    expect(html).toContain("window.open");
    expect(html).toContain("Open this picture in a new window");
  });

  test("asks for KaTeX's stylesheet only when a note has math", () => {

    const withMath = buildNotesHtml({
      ...plain,
      folders: [folder(1, "Read", [strip(11, 12, "$e = mc^2$")])],
      unfiled: [],
    });
    expect(withMath).toContain("katex.min.css");

    const without = buildNotesHtml({
      ...plain,
      folders: [folder(1, "Read", [strip(11, 12, "Plain words.")])],
      unfiled: [],
    });
    expect(without).not.toContain("katex.min.css");
  });

  test("shows a contents rail for a list worth navigating, not for three strips", () => {
    const long = buildNotesHtml({
      ...plain,
      folders: [folder(1, "One", [strip(11, 12, "a")]), folder(2, "Two", [strip(21, 13, "b")])],
      unfiled: [],
    });
    expect(long).toContain('class="toc"');
    expect(long).toContain('href="#strip-11"');

    const short = buildNotesHtml({
      ...plain,
      folders: [folder(1, "One", [strip(11, 12, "a")])],
      unfiled: [],
    });
    expect(short).not.toContain('class="toc"');
  });

  test("escapes the document's own text but not the rendered notes", () => {
    const html = buildNotesHtml({
      documentName: "Tom & Jerry's <script>alert(1)</script>",
      filePath: '/Users/reader/a&b/"quoted".pdf',
      folders: [folder(1, "R&D <draft>", [strip(11, 12, "**bold** & <em>kept</em>")])],
      unfiled: [],
      generatedAt: plain.generatedAt,
    });
    expect(html).toContain("Tom &amp; Jerry&#39;s &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("R&amp;D &lt;draft&gt;");
    expect(html).toContain("a&amp;b/&quot;quoted&quot;.pdf");
    // The note was rendered by the markdown pipeline, so its HTML is markup.
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toContain("<title>Tom & Jerry");
  });

  test("stamps the page and the export time in machine-readable form", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "Read", [strip(11, 12, "A note.")])],
      unfiled: [],
    });
    expect(html).toContain("Page 12");
    expect(html).toContain(new Date(plain.generatedAt).toISOString());
    expect(html).toContain('datetime="' + new Date(strip(11, 12, "").created_at).toISOString() + '"');
  });

  test("carries its own stylesheet and print rules, so it opens anywhere", () => {
    const html = buildNotesHtml({ ...plain, folders: [], unfiled: [] });
    expect(html).toContain("@media print");
    expect(html).toContain("--ink:");
    // Nothing but KaTeX is fetched, and only for math.
    const remote = html.match(/https?:\/\/[^"' ]+/g) ?? [];
    expect(remote.every((url) => url.includes("katex"))).toBe(true);
  });

  test("says so when a document has no strips at all", () => {
    const html = buildNotesHtml({ ...plain, folders: [], unfiled: [] });
    expect(html).toContain("No strips are saved for this document.");
  });

  test("a document with only unfiled strips still exports them", () => {
    const html = buildNotesHtml({ ...plain, folders: [], unfiled: [strip(41, 8, "Loose.")] });
    expect(html).toContain("Loose.");
    expect(html).toContain("No folder");
    // Nothing to count as a folder, and the head does not pretend otherwise.
    expect(html).not.toContain("<span>0 folders</span>");
  });
});
