import { describe, expect, test } from "bun:test";
import { buildNotesHtml, escapeHtml, renderNoteMarkdown } from "../src/notesHtml";
import type { Note, NoteFolderWithNotes } from "../src/types/dto";

/** A strip with only the fields the export reads filled in. */
function strip(id: number, page: number, remark: string, extra: Partial<Note> = {}): Note {
  return {
    id,
    pdf_document_id: 1,
    note_folder_id: null,
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
    expanded: true,
    highlights: "[]",
    created_at: new Date(2026, 10, 20, 14, 30, 0).getTime(),
    ...extra,
  };
}

function folder(id: number, name: string, strips: Note[]): NoteFolderWithNotes {
  return {
    id,
    pdf_document_id: 1,
    name,
    ordering: id,
    created_at: new Date(2026, 10, 19, 9, 0, 0).getTime(),
    notes: strips,
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

  test("writes every nested note without the width it was dragged to", () => {
    const html = renderNoteMarkdown("Example:\n\n[note:66?width=889]\n\n[note:68?width=480]");
    expect(html).toContain("[note:66]");
    expect(html).toContain("[note:68]");
    expect(html).not.toContain("?width=");
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

  test("keeps the folder structure as rows, and starts every one of them closed", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "One", [strip(11, 12, "a")]), folder(2, "Two", [strip(21, 13, "b")])],
      unfiled: [strip(90, 5, "Loose.")],
    });
    expect(html.match(/<details class="group" id="[^"]+">/g)?.length).toBe(3);
    expect(html.match(/<summary class="group-head">/g)?.length).toBe(3);
    // A closed `<details>` is one without `open`: no folder is unfolded on arrival.
    expect(html).not.toMatch(/<details[^>]*\sopen[^>]*>/);
  });

  test("puts the cards behind the row, so a closed folder shows only its name", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "Read", [strip(11, 12, "A note.")])],
      unfiled: [],
    });
    const summaryEnd = html.indexOf("</summary>");
    const body = html.indexOf('<div class="group-body">');
    expect(summaryEnd).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(summaryEnd);
    expect(html.indexOf('id="strip-11"')).toBeGreaterThan(body);
    // The row is the control, so it carries the pointer.
    expect(html).toContain(".group-head:hover");
    expect(html).toContain(".group-head::marker");
  });

  test("mirrors the folded state in the contents rail", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "One", [strip(11, 12, "a")]), folder(2, "Two", [strip(21, 13, "b")])],
      unfiled: [],
    });
    expect(html).toContain('class="toc-group is-closed" data-target="folder-1"');
    expect(html).toContain('class="toc-group is-closed" data-target="folder-2"');
    expect(html).toContain(".toc-group.is-closed > .toc-strips { display: none; }");
  });

  test("opens the folder a link points into before jumping to it", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "Read", [strip(11, 12, "A note.")])],
      unfiled: [],
    });
    expect(html).toContain("function folderAround(");
    expect(html).toContain("setOpen(folder, true)");
    // A file opened at `#strip-11`, and every later hash change, is handled too.
    expect(html).toContain("window.location.hash");
    expect(html).toContain("'hashchange'");
  });

  test("lets the reader open every folder at once, but never without the script", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "One", [strip(11, 12, "a")]), folder(2, "Two", [strip(21, 13, "b")])],
      unfiled: [],
    });
    // Rendered `hidden` and unhidden by the script: a button that cannot work is
    // worse than no button.
    expect(html).toContain('<button type="button" class="folders-toggle" hidden></button>');
    expect(html).toContain("toggleAll.hidden = false");

    const none = buildNotesHtml({ ...plain, folders: [], unfiled: [] });
    expect(none).not.toContain('class="folders-toggle"');
  });

  test("prints every folder, including the folded ones", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "Read", [strip(11, 12, "A note.")])],
      unfiled: [],
    });
    expect(html).toContain("'beforeprint'");
    expect(html).toContain("'afterprint'");
    // The fallback for an engine that never fires the printing events.
    expect(html).toContain("details.group::details-content");
    expect(html).toContain(".group:not([open]) > .group-body { display: block !important; }");
  });

  test("reserves a picture's box before it decodes", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "Read", [strip(11, 12, "A note.")])],
      unfiled: [],
      thumbnails: new Map([[11, "data:image/png;base64,iVBORw0KGgo="]]),
    });
    // The band is the page's full width by the strip's height: 612 × 40 points.
    expect(html).toContain('width="612" height="40"');
  });

  test("ships a script that parses", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "One", [strip(11, 12, "a")]), folder(2, "Two", [strip(21, 13, "b")])],
      unfiled: [strip(90, 5, "Loose.")],
    });
    const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
    expect(script.length).toBeGreaterThan(0);
    expect(() => new Function(script)).not.toThrow();
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

  test("lays a pin's writing as markdown over its picture", () => {
    // A canvas can only paint words, so the picture carries the pin and the writing
    // is HTML over it — the same markdown, math included, the page in the app shows.
    const html = buildNotesHtml({
      ...plain,
      folders: [
        folder(1, "Read", [
          strip(11, 12, "A note.", {
            annotations: JSON.stringify([
              { id: 7, x: 100, y: 20, width: 150, text: "$x^2$ and **bold**" },
            ]),
          }),
        ]),
      ],
      unfiled: [],
      thumbnails: new Map([[11, "data:image/png;base64,iVBORw0KGgo="]]),
    });
    expect(html).toContain('class="strip-writings"');
    expect(html).toContain('class="strip-writing markdown-body"');
    expect(html).toContain('class="katex');
    expect(html).toContain("<strong>bold</strong>");
    // Placed in the page's own points, as shares of the picture, so it keeps its place
    // and its scale at any width. Every offset is a share of the *width*, which is what
    // a percentage margin is resolved against — the vertical one included.
    expect(html).toMatch(
      /class="strip-writing[^"]*" style="--writing-font:[\d.]+cqw;--writing-line:[\d.]+cqw;margin-left:[\d.]+%;margin-top:[\d.]+%;width:[\d.]+%"/,
    );
    // The type is the pin's own, so it is on the card rather than on the layer: two
    // pins on one page may be written at two different sizes.
    expect(html).toMatch(/--writing-font:[\d.]+cqw/);
    expect(html).toMatch(/--writing-line:[\d.]+cqw/);
    // …and it is the band's own height that the layer is pulled up by, so the writing
    // may run past the bottom of the picture without being cropped: that height is the
    // layer's floor, and a deeper writing makes the figure deeper instead.
    expect(html).toMatch(/--strip-band:[\d.]+cqw/);
    expect(html).toContain("margin-top: calc(-1 * var(--strip-band");
    expect(html).toContain("min-height: var(--strip-band");
    expect(html).toContain("container-type: inline-size");
  });

  test("each pin's writing is exported at the size the reader chose", () => {
    // The type travels with the row, so a margin note taken up to 12 pt is 12 pt in
    // the file too — on the same page as one taken down to 6.
    const html = buildNotesHtml({
      ...plain,
      folders: [
        folder(1, "Read", [
          strip(11, 12, "A note.", {
            annotations: JSON.stringify([
              { id: 7, x: 100, y: 20, width: 150, font_size: 12, text: "bigger" },
              { id: 8, x: 100, y: 30, width: 150, font_size: 6, text: "smaller" },
            ]),
          }),
        ]),
      ],
      unfiled: [],
      thumbnails: new Map([[11, "data:image/png;base64,iVBORw0KGgo="]]),
    });
    const fonts = [...html.matchAll(/--writing-font:([\d.]+)cqw/g)].map((match) => Number(match[1]));
    expect(fonts).toHaveLength(2);
    // The bigger writing is twice the share of the picture's width.
    expect(fonts[0]).toBeCloseTo((fonts[1] as number) * 2, 2);
  });

  test("a pin the page leaves no room beside stays a pin", () => {
    // The pin is at the page's right edge, where the page leaves no room for a card
    // beside it: the pin is painted, and there is no writing to print under it.
    const html = buildNotesHtml({
      ...plain,
      folders: [
        folder(1, "Read", [
          strip(11, 12, "A note.", {
            annotations: JSON.stringify([{ id: 7, x: 600, y: 20, width: 150, text: "at the edge" }]),
          }),
        ]),
      ],
      unfiled: [],
      thumbnails: new Map([[11, "data:image/png;base64,iVBORw0KGgo="]]),
    });
    expect(html).toContain('class="strip-picture"');
    expect(html).not.toContain('class="strip-writing');
  });

  test("leaves out the writing of a pin the picture does not show", () => {
    // A pin off the band is painted nowhere, so its writing would be a paragraph with
    // nothing above it. The test strip is the band from 10 to 50 points; this pin is
    // at 200.
    const html = buildNotesHtml({
      ...plain,
      folders: [
        folder(1, "Read", [
          strip(11, 12, "A note.", {
            annotations: JSON.stringify([{ id: 7, x: 100, y: 200, width: 150, text: "off the band" }]),
          }),
        ]),
      ],
      unfiled: [],
      thumbnails: new Map([[11, "data:image/png;base64,iVBORw0KGgo="]]),
    });
    expect(html).toContain('class="strip-picture"');
    expect(html).not.toContain('class="strip-writing');
    expect(html).not.toContain("off the band");
  });

  test("a pin's math asks for KaTeX's stylesheet, like a note's", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [
        folder(1, "Read", [
          strip(11, 12, "No math here.", {
            annotations: JSON.stringify([{ id: 7, x: 100, y: 20, width: 150, text: "$a^2$" }]),
          }),
        ]),
      ],
      unfiled: [],
      thumbnails: new Map([[11, "data:image/png;base64,iVBORw0KGgo="]]),
    });
    expect(html).toContain("katex.min.css");
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
    // The window takes the picture's whole figure, so the pins' writings printed
    // under it are in it too, with the page's styles made to travel.
    expect(html).toContain("cloneNode(true)");
    expect(html).toContain("function copyStyles(");
    expect(html).toContain("strip-picture");
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

  test("lets the strip picture run to the card's edges", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "Read", [strip(11, 12, "A note.")])],
      unfiled: [],
      thumbnails: new Map([[11, "data:image/png;base64,iVBORw0KGgo="]]),
    });
    expect(html).toMatch(/\.strip-picture\s*\{[^}]*padding:\s*0/);
    expect(html).not.toMatch(/\.strip-picture img\s*\{[^}]*border(?:-radius)?:/);
  });

  test("tints each note with the strip list's paper green", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "Read", [strip(11, 12, "A note."), strip(12, 13, "   ")])],
      unfiled: [],
    });
    // --notes-card in App.css. Both a written note and an empty one live in
    // .strip-text, so the green covers every card's note, not only the ones
    // that have markdown.
    expect(html).toContain("--note: #d2e4d7");
    expect(html).toContain("--note-ink: #16241d");
    expect(html).toMatch(/\.strip-text\s*\{[^}]*background:\s*var\(--note\)/);
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

  test("leaves a folded strip out of the list, and still draws it where an open note points at it", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [
        folder(1, "Read", [
          strip(11, 12, "See [note:12?width=480] for the passage."),
          strip(12, 13, "Folded away.", { expanded: false }),
        ]),
      ],
      unfiled: [strip(90, 5, "Also folded.", { expanded: false })],
      thumbnails: new Map([[12, "data:image/png;base64,folded"]]),
    });
    expect(html).toContain('id="strip-11"');
    expect(html).toContain("See");
    expect(html).toContain("for the passage.");
    expect(html).toContain('class="nested-note"');
    expect(html).toContain("Folded away.");
    expect(html).toContain("data:image/png;base64,folded");
    expect(html).toContain("Page 13");
    // The dragged width does not travel, and the folded card is not a strip of
    // its own: no anchor, and the count stays the one open card.
    expect(html).not.toContain("?width=");
    expect(html).not.toContain('id="strip-12"');
    expect(html).not.toContain('id="strip-90"');
    expect(html).not.toContain("Also folded.");
    expect(html).toContain("<span>1 strip</span>");
  });

  test("stops when a note points at itself, and says when the note is not in this document", () => {
    const html = buildNotesHtml({
      ...plain,
      folders: [folder(1, "Read", [strip(11, 12, "Again [note:11], and [note:99].")])],
      unfiled: [],
    });
    expect(html).toContain("Note 11 is already open above");
    expect(html).toContain("Note 99 is not in this document");
    expect(html).not.toContain('id="strip-99"');
  });

  test("a document with only unfiled strips still exports them", () => {
    const html = buildNotesHtml({ ...plain, folders: [], unfiled: [strip(41, 8, "Loose.")] });
    expect(html).toContain("Loose.");
    expect(html).toContain("No folder");
    // Nothing to count as a folder, and the head does not pretend otherwise.
    expect(html).not.toContain("<span>0 folders</span>");
  });
});
