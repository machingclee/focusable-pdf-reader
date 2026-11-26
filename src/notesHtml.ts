/**
 * One document's notes as a standalone HTML file.
 *
 * The export is the reading copy of what the Notes column and the Dashboard tab
 * show: the same folders, in the same order, with each strip's picture, page and
 * note. It has to survive leaving the app — mailed, put in a folder, opened on a
 * phone — so the only things it asks for over the network are KaTeX's stylesheet
 * and fonts, and only when a note actually contains math.
 *
 * It keeps the folder structure the app shows, and it keeps it folded: every
 * folder is a row that opens, closed to begin with, exactly as the notes column
 * opens. A file that read as chapter after chapter of notes would bury its own
 * index — the reader would scroll past four folders to reach the fifth — and
 * would paint every strip picture in the document just to show the first one.
 * The rows are `<details>` elements, so the opening is the browser's, not this
 * module's: it works with scripts blocked, from the keyboard, and in whatever
 * engine the reader's phone happens to ship.
 *
 * Everything here is pure: no DOM, no Tauri, no React. Markdown becomes HTML
 * through the same remark/rehype family the note popup uses (GFM, math, raw HTML,
 * highlighting), numbers are formatted with `Intl`, and the strip pictures arrive
 * as data URLs from `notesExport.ts`, which is the half that owns a canvas.
 * Keeping the split here means the file's shape can be asserted in a test rather
 * than inspected by eye.
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import { noteSummary } from "./notesText";
import type { Note, NoteFolderWithNotes } from "./types/dto";

export type NotesHtmlInput = {
  /** The document's name, as the notes list shows it. */
  documentName: string;
  /** Where the PDF lives: provenance for a file that may outlive the app. */
  filePath: string;
  folders: NoteFolderWithNotes[];
  /** Strips that sit in no folder, in their own order. */
  unfiled: Note[];
  /** When the export was written, in epoch milliseconds. */
  generatedAt: number;
  /**
   * Strip pictures as PNG data URLs, keyed by strip id. A missing entry is not
   * an error: a moved PDF still exports its notes, just without the pictures.
   */
  thumbnails?: ReadonlyMap<number, string>;
};

/* ── Escaping and formatting ──────────────────────────────────────────────── */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape text for HTML. Every value that is not a rendered markdown tree goes through this. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

/** `1 folder` / `2 folders`, without the caller repeating the plural rule. */
function count(value: number, one: string, many = `${one}s`): string {
  return `${value} ${value === 1 ? one : many}`;
}

/** A timestamp that still reads correctly months after the export was written. */
function formatMoment(milliseconds: number): string {
  return new Date(milliseconds).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A `<time>` element, so the machine-readable instant survives the pretty text. */
function timeTag(milliseconds: number): string {
  return `<time datetime="${new Date(milliseconds).toISOString()}">${escapeHtml(formatMoment(milliseconds))}</time>`;
}

/* ── Markdown ─────────────────────────────────────────────────────────────── */

/**
 * The note pipeline: the popup previewer's plugin list, minus the app-only
 * passes (source-line tags, search highlighting, heading ids for a contents
 * sidebar inside the note).
 *
 * Built once at module scope: `unified` processors are immutable once frozen by
 * the first `processSync`, and every note in an export wants the same one.
 */
const noteProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeHighlight)
  .use(rehypeKatex)
  .use(rehypeStringify, { allowDangerousHtml: true })
  .freeze();

/**
 * Render one note's markdown.
 *
 * A note that cannot be parsed must not cost the reader the other fifty, so a
 * failure falls back to the note's own text rather than throwing out of the
 * export.
 */
export function renderNoteMarkdown(markdown: string): string {
  try {
    return String(noteProcessor.processSync(markdown));
  } catch {
    return `<p class="note-fallback">${escapeHtml(markdown)}</p>`;
  }
}

/* ── The document ─────────────────────────────────────────────────────────── */

type Group = {
  /** Anchor id, unique across folders and the unfiled section. */
  id: string;
  name: string;
  strips: Note[];
};

/** KaTeX's stylesheet and fonts, the export's one network dependency. */
const KATEX_STYLESHEET = "https://cdn.jsdelivr.net/npm/katex@0/dist/katex.min.css";

/**
 * A folder icon, inline so the file needs no image of its own.
 *
 * Sized and drawn like the row it sits in: 19 px, next to a 15 px name, which is
 * the same proportion the notes column uses. A folder in this file is a level of
 * the structure rather than a section title over a page of cards — the rows fold,
 * so the icon marks which row is a folder and leaves the words to carry the name.
 */
const FOLDER_ICON =
  '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

/**
 * The disclosure arrow: one glyph that turns, so a row never changes width when
 * its folder opens or closes.
 *
 * Drawn pointing right because that is the state every folder ships in, and
 * rotated a quarter turn by `[open]` in the stylesheet. The size is the row's, not
 * the icon's: it has to read as a control beside a folder name, not as a second
 * icon competing with it.
 */
const CHEVRON_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M9 5l7 7-7 7"/></svg>';

/** The folder-shaped groups of the document, in the order the notes list shows them. */
function buildGroups(folders: NoteFolderWithNotes[], unfiled: Note[]): Group[] {
  const groups: Group[] = folders.map((folder) => ({
    id: `folder-${folder.id}`,
    name: folder.name,
    strips: folder.notes,
  }));
  // The app's "No folder" section sits below the folders, so it is last here too.
  if (unfiled.length > 0) {
    groups.push({ id: "group-unfiled", name: "No folder", strips: unfiled });
  }
  return groups;
}

/**
 * One strip: its picture, where it came from, and the note itself.
 *
 * The picture carries its size in PDF points. The band is always the page's full
 * width by the strip's height, so the ratio is known before a pixel decodes — and
 * the box keeps that height while the browser defers the picture, which is what
 * makes a jump into a folder land on the right card instead of somewhere above it.
 */
function stripCard(strip: Note, thumbnails: ReadonlyMap<number, string> | undefined): string {
  const note = strip.remark.trim();
  const picture = thumbnails?.get(strip.id);
  const alt = `Page ${strip.page_number} of the PDF, the saved strip`;
  const knownBox =
    strip.page_width > 0 && strip.height > 0
      ? ` width="${Math.max(1, Math.round(strip.page_width))}" height="${Math.max(1, Math.round(strip.height))}"`
      : "";

  const figure = picture
    ? `<figure class="strip-picture"><img src="${escapeHtml(picture)}" alt="${escapeHtml(alt)}"${knownBox} loading="lazy" /></figure>`
    : "";

  const body = note
    ? `<div class="note markdown-body">${renderNoteMarkdown(strip.remark)}</div>`
    : `<p class="note is-empty">${escapeHtml(strip.text_excerpt || "No note on this strip yet.")}</p>`;

  return (
    `<article class="strip" id="strip-${strip.id}">${figure}` +
    `<div class="strip-text">` +
    `<p class="strip-meta"><span class="strip-page">Page ${strip.page_number}</span>` +
    `<span class="dot">·</span><span class="strip-saved">Saved ${timeTag(strip.created_at)}</span>` +
    (note ? "" : `<span class="dot">·</span><span class="strip-flag">no note</span>`) +
    `</p>${body}</div></article>`
  );
}

/**
 * One folder, folded.
 *
 * The row is a `<summary>`, which is the whole control: a click anywhere on it
 * opens or closes the folder, the browser draws the focus ring and answers the
 * keyboard, and the file's folder structure is still there for a reader whose
 * browser is told not to run scripts.
 *
 * The count follows the name the way the notes column sets it, because the row is
 * read left to right: chevron, folder, name, how much is in it.
 */
function folderSection(group: Group, thumbnails: ReadonlyMap<number, string> | undefined): string {
  const cards = group.strips.map((strip) => stripCard(strip, thumbnails)).join("\n");
  return (
    `<details class="group" id="${group.id}">` +
    `<summary class="group-head">` +
    `<span class="group-toggle">${CHEVRON_ICON}</span>` +
    `<span class="group-icon">${FOLDER_ICON}</span>` +
    `<h2 class="group-name">${escapeHtml(group.name)}</h2>` +
    `<span class="group-count">${count(group.strips.length, "strip")}</span>` +
    `</summary>` +
    `<div class="group-body">` +
    (cards || `<p class="group-empty">No strips in this folder.</p>`) +
    `</div></details>`
  );
}

/**
 * The contents rail: one entry per group, with the strips beneath it.
 *
 * A long export is read by jumping, so the strip entries carry the page number
 * and the first line of the note — the same label the card's tooltip uses.
 *
 * The rail is the page's map, so it is folded with the page: a folder's strips are
 * only listed under it while the folder is open, and the entry's own chevron is
 * the control that opens it. Each entry carries the id of the folder it stands for
 * (`data-target`) so the script that keeps the two in step has one thing to read.
 */
function contentsList(groups: Group[]): string {
  const items = groups.map((group) => {
    const strips = group.strips
      .map((strip) => {
        const label = noteSummary(strip.remark, 64) || strip.text_excerpt || "No note";
        return (
          `<li class="toc-strip"><a href="#strip-${strip.id}">` +
          `<span class="toc-page">p${strip.page_number}</span>` +
          `<span class="toc-label">${escapeHtml(label)}</span></a></li>`
        );
      })
      .join("");
    return (
      `<li class="toc-group is-closed" data-target="${group.id}">` +
      `<a href="#${group.id}" class="toc-group-link">` +
      `<span class="toc-toggle">${CHEVRON_ICON}</span>` +
      `<span class="toc-name">${escapeHtml(group.name)}</span>` +
      `<span class="toc-count">${group.strips.length}</span></a>` +
      (strips ? `<ul class="toc-strips">${strips}</ul>` : "") +
      `</li>`
    );
  });

  return (
    `<aside class="toc" aria-label="Contents"><div class="toc-inner">` +
    `<p class="toc-head">Contents</p>` +
    `<nav><ul class="toc-list">${items.join("")}</ul></nav>` +
    `</div></aside>`
  );
}

/**
 * Build the whole file.
 *
 * The contents rail only appears when there is something to navigate: with two
 * groups, or a list long enough to scroll, it earns its width; over a
 * three-strip export it would be a column of one-click links to the three
 * things visible anyway.
 */
export function buildNotesHtml(input: NotesHtmlInput): string {
  const { documentName, filePath, folders, unfiled, generatedAt, thumbnails } = input;
  const groups = buildGroups(folders, unfiled);
  const strips = groups.flatMap((group) => group.strips);
  const withNotes = strips.filter((strip) => strip.remark.trim().length > 0).length;
  const showContents = groups.length >= 2 || strips.length >= 8;

  const sections = groups.map((group) => folderSection(group, thumbnails)).join("\n");

  // Math is the only reason to fetch anything: KaTeX ships its own HTML but the
  // spacing, sizes and glyphs live in that stylesheet.
  const needsKatex = sections.includes('class="katex');
  const katexLink = needsKatex
    ? `\n  <link rel="stylesheet" href="${KATEX_STYLESHEET}" crossorigin="anonymous" />`
    : "";

  const title = `${documentName} — Notes`;
  // Folders are only worth counting when there are some: a document whose strips
  // are all unfiled would otherwise open with "0 folders" over its head.
  const summary =
    `<span>${count(strips.length, "strip")}</span>` +
    `<span class="dot">·</span><span>${count(withNotes, "note")}</span>` +
    (folders.length > 0 ? `<span class="dot">·</span><span>${count(folders.length, "folder")}</span>` : "");

  // The one action the page starts with: opening every folder at once. It is
  // `hidden` in the file and unhidden by the script, because a button that cannot
  // do anything is worse than no button — with scripts blocked, the rows are still
  // the control, and they work on their own.
  const folderTool = `<button type="button" class="folders-toggle" hidden></button>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="generator" content="PDF Focus Viewer" />
  <title>${escapeHtml(title)}</title>${katexLink}
  <style>
${EXPORT_CSS}
  </style>
</head>
<body>
  <div class="page">
    ${showContents ? contentsList(groups) : ""}
    <main class="notes">
      <header class="doc-head">
        <p class="doc-eyebrow">Notes of this PDF</p>
        <h1 class="doc-title">${escapeHtml(documentName)}</h1>
        <p class="doc-counts">${summary}${groups.length > 0 ? folderTool : ""}</p>
        <p class="doc-path"><span class="doc-path-label">PDF</span><span>${escapeHtml(filePath)}</span></p>
      </header>
${sections ? `      <div class="groups">\n${sections}\n      </div>` : `      <p class="notes-empty">No strips are saved for this document.</p>`}
      <footer class="doc-foot">
        <p>Exported from <strong>PDF Focus Viewer</strong> on ${timeTag(generatedAt)}.</p>
      </footer>
    </main>
  </div>
  <script>
${EXPORT_SCRIPT}
  </script>
</body>
</html>
`;
}

/* ── The stylesheet ───────────────────────────────────────────────────────── */

/**
 * Light, printable, and self-contained: a saved note file is read in a browser
 * that knows nothing about this app, and often on paper. The palette is the
 * familiar GitHub one so a code block, a quote and a table all read the way the
 * reader already expects.
 */
const EXPORT_CSS = `    :root {
      --ink: #1f2328;
      --ink-soft: #59636e;
      --ink-faint: #818b98;
      --line: #d1d9e0;
      --line-soft: #eaeef2;
      --bg: #ffffff;
      --bg-soft: #f6f8fa;
      --accent: #0969da;
      --side: 264px;
      /* The strip list's card, copied from --notes-card, --notes-card-ink and
         --notes-card-ink-muted in App.css. This file is opened outside the app,
         so it cannot read those variables and has to carry the same colours. */
      --note: #d2e4d7;
      --note-ink: #16241d;
      --note-ink-muted: #3c5a4c;
    }
    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 16px;
      line-height: 1.65;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .page { display: flex; align-items: flex-start; }

    /* ── Contents ─────────────────────────────────────────────────────── */
    .toc {
      position: sticky;
      top: 0;
      flex: 0 0 var(--side);
      width: var(--side);
      max-height: 100vh;
      overflow-y: auto;
      padding: 26px 14px 40px 22px;
      border-right: 1px solid var(--line-soft);
      background: var(--bg);
      font-size: 13px;
    }
    .toc-head {
      margin: 0 0 10px;
      color: var(--ink-faint);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .toc-list, .toc-strips { margin: 0; padding: 0; list-style: none; }
    .toc-group { margin-bottom: 8px; }
    .toc-group-link {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 6px;
      border-radius: 6px;
      color: var(--ink);
      font-weight: 600;
    }
    .toc-group-link:hover { background: var(--bg-soft); text-decoration: none; }
    /* The rail's own copy of the folder's chevron: right while the folder is
       closed, turned down once it opens. It is the rail's state as much as the
       folder's, so it is drawn from the entry's class rather than the details'. */
    .toc-toggle {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      color: var(--ink-faint);
    }
    .toc-toggle svg {
      width: 12px;
      height: 12px;
      transition: transform 120ms ease;
    }
    .toc-group:not(.is-closed) > .toc-group-link .toc-toggle svg { transform: rotate(90deg); }
    .toc-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toc-count {
      margin-left: auto;
      color: var(--ink-faint);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    .toc-strips { margin: 2px 0 0 6px; }
    /* The rail is the page's map, so a folded folder lists no strips: the entries
       for cards the reader cannot see yet would only be a second index. */
    .toc-group.is-closed > .toc-strips { display: none; }
    .toc-strip a {
      display: flex;
      gap: 6px;
      padding: 2px 6px;
      border-left: 2px solid transparent;
      border-radius: 0 6px 6px 0;
      color: var(--ink-soft);
      line-height: 1.45;
    }
    .toc-strip a:hover { background: var(--bg-soft); color: var(--ink); text-decoration: none; }
    .toc-page {
      flex: 0 0 auto;
      color: var(--ink-faint);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      padding-top: 1px;
    }
    .toc-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toc-group.is-active > .toc-group-link { background: var(--bg-soft); }
    .toc-strip.is-active > a {
      border-left-color: var(--accent);
      background: rgba(9, 105, 218, 0.07);
      color: var(--ink);
    }

    /* ── The document ─────────────────────────────────────────────────── */
    .notes {
      flex: 1 1 auto;
      min-width: 0;
      max-width: 780px;
      margin: 0 auto;
      padding: 40px 32px 96px;
    }
    .doc-eyebrow {
      margin: 0;
      color: var(--ink-faint);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .doc-title {
      margin: 6px 0 10px;
      font-size: 1.9em;
      font-weight: 700;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .doc-counts {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 7px;
      margin: 0 0 12px;
      color: var(--ink-soft);
      font-size: 13px;
    }
    .dot { color: var(--ink-faint); }
    /* The one action the head offers: open every folder, or close them again.
       Sized like the counts it sits after, because it is about them: it changes
       how much of the list is showing, not what the list is. */
    .folders-toggle {
      margin-left: auto;
      padding: 2px 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--bg);
      color: var(--ink-soft);
      font: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }
    .folders-toggle:hover { background: var(--bg-soft); color: var(--ink); }
    .folders-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .doc-path {
      display: flex;
      gap: 8px;
      align-items: baseline;
      margin: 0;
      padding: 9px 12px;
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      background: var(--bg-soft);
      color: var(--ink-soft);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .doc-path-label {
      flex: 0 0 auto;
      color: var(--ink-faint);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding-top: 1px;
    }

    /* ── Folders ──────────────────────────────────────────────────────── */
    /* A folder is a row that opens, never a page of cards under a title: the
       list starts closed, and the row's hairline is the seam between one folder
       and the next. That is the shape the notes column has, and it is what makes
       an export of forty folders worth opening rather than an ordeal. */
    .groups { margin-top: 30px; border-top: 1px solid var(--line-soft); }
    .group {
      border-bottom: 1px solid var(--line-soft);
      scroll-margin-top: 16px;
    }
    /* The native triangle would sit beside the chevron and repeat it. */
    .group-head::-webkit-details-marker { display: none; }
    .group-head::marker { content: ""; }
    .group-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 13px 6px;
      list-style: none;
      cursor: pointer;
      border-radius: 8px;
      -webkit-tap-highlight-color: transparent;
    }
    /* The whole row is the control, so the whole row answers the pointer. */
    .group-head:hover { background: var(--bg-soft); }
    .group-head:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .group-toggle, .group-icon {
      display: flex;
      flex: 0 0 auto;
      align-items: center;
      color: var(--ink-faint);
    }
    .group-toggle svg { transition: transform 120ms ease; }
    /* Closed points right, open points down: one glyph, turned. No state removes
       it, so the row does not jump sideways when a folder opens. */
    .group[open] > .group-head .group-toggle svg { transform: rotate(90deg); }
    .group-name {
      flex: 0 1 auto;
      min-width: 0;
      margin: 0;
      overflow: hidden;
      color: var(--ink);
      font-size: 15px;
      font-weight: 600;
      line-height: 1.35;
      letter-spacing: 0;
      text-align: left;
      text-overflow: ellipsis;
      text-transform: none;
      white-space: nowrap;
    }
    .group-count {
      flex: 0 0 auto;
      color: var(--ink-faint);
      font-size: 12px;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }
    .group-body { padding: 4px 0 20px; }
    .group-empty {
      margin: 0 0 8px;
      color: var(--ink-faint);
      font-size: 13px;
      font-style: italic;
    }

    /* One strip: the picture, then the note that is about it.
       The card's own edge is the stronger line (--line): on white paper at print
       size a --line-soft hairline all but disappears, and the card reads as one
       merged block with the note under the one above it. */
    .strip {
      scroll-margin-top: 16px;
      margin: 0 0 22px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--bg);
      overflow: hidden;
      break-inside: avoid;
    }
    /* The picture is the card's face and runs to its edges, the way the strip
       list's preview does. A padded mat, or a border of the picture's own, read
       as a frame around the page. The card's radius clips the top corners. */
    .strip-picture {
      margin: 0;
      padding: 0;
      border-bottom: 1px solid var(--line-soft);
    }
    .strip-picture img {
      display: block;
      width: 100%;
      height: auto;
      background: #fff;
    }
    /* The picture stays page-white. Everything under it is the note, and it sits
       on the same paper-green the strip list paints its cards with. The green
       runs to the card's edges: a chip inside the white padding would read as a
       highlight, not as the note's own surface. */
    .strip-text {
      padding: 11px 14px 13px;
      background: var(--note);
      color: var(--note-ink);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .strip-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin: 0 0 8px;
      color: var(--note-ink-muted);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    .strip-page { font-weight: 600; color: var(--note-ink); }
    .strip-flag { font-style: italic; }
    .note.is-empty {
      margin: 0;
      color: var(--note-ink-muted);
      font-size: 13px;
      font-style: italic;
    }
    .note-fallback { white-space: pre-wrap; }

    /* ── Markdown ─────────────────────────────────────────────────────── */
    .markdown-body > :first-child { margin-top: 0; }
    .markdown-body > :last-child { margin-bottom: 0; }
    .markdown-body h1, .markdown-body h2, .markdown-body h3,
    .markdown-body h4, .markdown-body h5, .markdown-body h6 {
      margin: 1.1em 0 0.5em;
      line-height: 1.35;
      font-weight: 600;
    }
    .markdown-body h1 { font-size: 1.3em; padding-bottom: 0.2em; border-bottom: 1px solid var(--line-soft); }
    .markdown-body h2 { font-size: 1.15em; }
    .markdown-body h3 { font-size: 1.05em; }
    .markdown-body h4, .markdown-body h5, .markdown-body h6 { font-size: 1em; }
    .markdown-body p { margin: 0.55em 0; }
    .markdown-body ul, .markdown-body ol { margin: 0.55em 0; padding-left: 1.6em; }
    .markdown-body li { margin: 0.18em 0; }
    .markdown-body li > p { margin: 0.18em 0; }
    .markdown-body ul.contains-task-list { padding-left: 1.4em; list-style: none; }
    .markdown-body li.task-list-item { list-style: none; }
    .markdown-body input[type="checkbox"] {
      width: 14px;
      height: 14px;
      margin: 0 0.45em 0 -1.15em;
      vertical-align: -0.12em;
      accent-color: #2563eb;
    }
    .markdown-body blockquote {
      margin: 0.6em 0;
      padding: 0.1em 0 0.1em 1em;
      border-left: 3px solid var(--line);
      color: var(--ink-soft);
    }
    .markdown-body hr { height: 1px; margin: 1.3em 0; border: 0; background: var(--line); }
    .markdown-body img {
      max-width: 100%;
      height: auto;
      border-radius: 6px;
      box-shadow: 0 0 0 1px rgba(22, 36, 29, 0.14), 0 1px 2px rgba(22, 36, 29, 0.12), 0 8px 16px -6px rgba(22, 36, 29, 0.28);
    }
    .markdown-body code {
      padding: 0.15em 0.35em;
      border: 1px solid var(--line-soft);
      border-radius: 5px;
      background: var(--bg-soft);
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      font-size: 0.88em;
      overflow-wrap: anywhere;
    }
    .markdown-body pre {
      margin: 0.7em 0;
      padding: 13px 14px;
      overflow-x: auto;
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      background: var(--bg-soft);
      line-height: 1.5;
    }
    .markdown-body pre code {
      padding: 0;
      border: 0;
      background: transparent;
      font-size: 0.86em;
      overflow-wrap: normal;
    }
    /* Code on the green paper darkens it a step, the way a card's code does,
       instead of cutting a white rectangle out of the note. These follow the
       rules above so they win: a note is the only place markdown is rendered. */
    .note code, .note pre {
      background: rgba(22, 36, 29, 0.08);
      border-color: rgba(22, 36, 29, 0.12);
    }
    .note pre code { background: transparent; border: 0; }
    .markdown-body table {
      width: 100%;
      margin: 0.7em 0;
      border-collapse: collapse;
      font-size: 0.94em;
    }
    .markdown-body th, .markdown-body td {
      padding: 6px 10px;
      border: 1px solid var(--line);
      text-align: left;
    }
    .markdown-body th { background: var(--bg-soft); font-weight: 600; }
    .markdown-body details { margin: 0.6em 0; }
    .markdown-body summary { cursor: pointer; }

    /* Code blocks get a copy button; the wrapper is what positions it. The extra
       right padding keeps a long line from running underneath the button. */
    .code-block { position: relative; }
    .code-block > pre { padding-right: 58px; }
    .code-copy {
      position: absolute;
      top: 7px;
      right: 7px;
      padding: 3px 7px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.94);
      color: var(--ink-soft);
      font: 500 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
    }
    .code-copy:hover { background: #fff; color: var(--ink); }

    /* highlight.js, light theme */
    .markdown-body .hljs { color: #24292f; background: transparent; }
    .markdown-body .hljs-comment, .markdown-body .hljs-quote { color: #6e7781; font-style: italic; }
    .markdown-body .hljs-keyword, .markdown-body .hljs-selector-tag,
    .markdown-body .hljs-literal, .markdown-body .hljs-doctag,
    .markdown-body .hljs-meta .hljs-keyword { color: #cf222e; }
    .markdown-body .hljs-string, .markdown-body .hljs-regexp, .markdown-body .hljs-addition,
    .markdown-body .hljs-attribute, .markdown-body .hljs-meta .hljs-string { color: #0a3069; }
    .markdown-body .hljs-number, .markdown-body .hljs-symbol,
    .markdown-body .hljs-bullet, .markdown-body .hljs-link { color: #0550ae; }
    .markdown-body .hljs-title, .markdown-body .hljs-section, .markdown-body .hljs-name,
    .markdown-body .hljs-selector-id, .markdown-body .hljs-selector-class,
    .markdown-body .hljs-title.function_ { color: #8250df; }
    .markdown-body .hljs-built_in, .markdown-body .hljs-type,
    .markdown-body .hljs-class .hljs-title { color: #953800; }
    .markdown-body .hljs-attr, .markdown-body .hljs-variable,
    .markdown-body .hljs-template-variable, .markdown-body .hljs-property { color: #0550ae; }
    .markdown-body .hljs-tag { color: #116329; }
    .markdown-body .hljs-deletion { color: #82071e; background: #ffebe9; }
    .markdown-body .hljs-emphasis { font-style: italic; }
    .markdown-body .hljs-strong { font-weight: 600; }

    /* A picture that opens in a window of its own says so with the cursor; the
       keyboard reaches it too, so the focus ring has to be visible. */
    img.zoomable { cursor: zoom-in; }
    img.zoomable:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    /* KaTeX, when the note has math */
    .markdown-body .katex { font-size: 1.05em; }
    .markdown-body .katex-display { margin: 0.8em 0; overflow-x: auto; overflow-y: hidden; }

    /* ── The end of the document ──────────────────────────────────────── */
    .notes-empty { margin: 40px 0; color: var(--ink-faint); }
    .doc-foot {
      margin-top: 48px;
      padding-top: 14px;
      border-top: 1px solid var(--line-soft);
      color: var(--ink-faint);
      font-size: 12px;
    }
    .doc-foot p { margin: 0; }

    /* A sidebar is not a page of notes, and a folded folder is not a page either:
       paper has no clicks, so the script opens every folder before the print and
       closes it again after. The two rules below are the fallback for a browser
       that never fires the printing events — newer engines hide folded content in
       the details-content pseudo-element, older ones in a shadow slot, and neither
       is reachable from one declaration, so both are named. */
    @media print {
      .toc, .code-copy, .folders-toggle, .group-toggle { display: none !important; }
      .group:not([open]) > .group-body { display: block !important; }
      details.group::details-content { content-visibility: visible !important; }
      .page { display: block; }
      .notes { max-width: none; padding: 0; }
      body { font-size: 11pt; line-height: 1.55; }
      .strip { break-inside: avoid; box-shadow: none; }
      /* A folder's name stays with the first strip under it. */
      .group-head { break-after: avoid; padding: 6px 0; }
      .group-body { padding: 0 0 12px; }
      .group { border-bottom: 0; }
      .groups { border-top: 0; margin-top: 22px; }
      a { color: inherit; text-decoration: none; }
      .markdown-body pre { white-space: pre-wrap; }
      @page { margin: 16mm 14mm; }
    }

    /* On a phone the contents rail would eat the page: it becomes a top block. */
    @media (max-width: 820px) {
      .page { display: block; }
      .toc {
        position: static;
        width: auto;
        max-height: none;
        border-right: 0;
        border-bottom: 1px solid var(--line-soft);
        padding: 20px 18px 12px;
      }
      .notes { padding: 24px 18px 64px; }
    }`;

/* ── The script ───────────────────────────────────────────────────────────── */

/**
 * What the reading copy does that a static page cannot: a copy button on every
 * code block, a strip picture that opens in a window of its own, folders that
 * stay in step with the contents rail, links that open the folder they point
 * into, one button that opens them all, printing that never loses a folded card,
 * and a rail that follows the reader.
 *
 * Kept as plain ES5-ish script so the file opens anywhere, with no build step and
 * no network. None of it is required to read the export: the folders are
 * `<details>`, so they open on their own with this switched off.
 */
const EXPORT_SCRIPT = `  (function () {
    // Copy buttons on fenced blocks, wrapped so the button can be positioned.
    function copyText(text, button) {
      function done() {
        var previous = button.textContent;
        button.textContent = 'Copied';
        setTimeout(function () { button.textContent = previous; }, 1200);
      }
      function fallback() {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        try { document.execCommand('copy'); done(); } catch (error) { /* nothing to do */ }
        document.body.removeChild(area);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else {
        fallback();
      }
    }

    Array.prototype.forEach.call(document.querySelectorAll('.markdown-body pre'), function (pre) {
      if (pre.parentElement && pre.parentElement.className === 'code-block') return;
      var wrap = document.createElement('div');
      wrap.className = 'code-block';
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'code-copy';
      button.textContent = 'Copy';
      button.addEventListener('click', function () {
        copyText((pre.textContent || '').replace(/\\n$/, ''), button);
      });
      wrap.appendChild(button);
    });

    // A strip's snapshot is worth opening on its own: it is a slice of the page,
    // and at reading width its small type is a guess. The pictures are data URLs,
    // which browsers refuse to navigate to in a new tab ("not allowed to navigate
    // top frame to data:"), so a click builds the window and puts the picture in
    // it rather than following a link. Pictures that live on the web get a real
    // link, because those open the way a reader expects.
    function openPicture(img) {
      var win = window.open('', '_blank');
      if (!win) return;
      var caption = img.getAttribute('alt') || 'Saved strip';
      var doc = win.document;
      doc.open();
      doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title></title><style>' +
        'html,body{height:100%;margin:0;background:#17191d}' +
        'body{display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}' +
        'img{max-width:100%;max-height:100%;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,0.45)}' +
        '</style></head><body></body></html>');
      doc.close();
      doc.title = caption;
      var full = doc.createElement('img');
      full.alt = caption;
      full.src = img.getAttribute('src') || '';
      doc.body.appendChild(full);
    }

    Array.prototype.forEach.call(document.querySelectorAll('img'), function (img) {
      // An image a note already wrapped in a link keeps that link's destination.
      if (img.parentElement && img.parentElement.tagName === 'A') return;
      var src = img.getAttribute('src') || '';
      if (/^https?:/i.test(src)) {
        var link = document.createElement('a');
        link.href = src;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        img.parentNode.insertBefore(link, img);
        link.appendChild(img);
        return;
      }
      if (!/^data:image\\//i.test(src)) return;
      img.className = (img.className ? img.className + ' ' : '') + 'zoomable';
      img.setAttribute('role', 'button');
      img.setAttribute('tabindex', '0');
      img.title = 'Open this picture in a new window';
      img.addEventListener('click', function () { openPicture(img); });
      img.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openPicture(img);
        }
      });
    });

    // ── Folders ───────────────────────────────────────────────────────────
    // Each folder is a <details> and its row a <summary>, so the opening and
    // closing is the browser's: a click, a tap, Enter or Space, with this script
    // or without it. What the script owes the page is everything that has to agree
    // with that state — the contents rail, a link that points inside a folded
    // folder, the button that folds them all, and paper, which cannot click.
    var folders = Array.prototype.slice.call(document.querySelectorAll('details.group'));
    var toc = document.querySelector('.toc');
    var toggleAll = document.querySelector('.folders-toggle');

    function railEntry(folder) {
      if (!toc) return null;
      return toc.querySelector('.toc-group[data-target="' + folder.id + '"]');
    }

    function syncRail(folder) {
      var entry = railEntry(folder);
      if (entry) entry.classList.toggle('is-closed', !folder.open);
    }

    function setOpen(folder, open) {
      folder.open = open;
      syncRail(folder);
    }

    function anyClosed() {
      return folders.some(function (folder) { return !folder.open; });
    }

    function labelToggleAll() {
      if (!toggleAll || toggleAll.hidden) return;
      toggleAll.textContent = anyClosed() ? 'Expand all' : 'Collapse all';
    }

    folders.forEach(function (folder) {
      syncRail(folder);
      // The row is the browser's control; this event is how the rest of the page
      // hears about it, whoever caused it.
      folder.addEventListener('toggle', function () {
        syncRail(folder);
        labelToggleAll();
        scheduleSpy();
      });
    });

    if (toggleAll) {
      if (folders.length > 1) {
        toggleAll.hidden = false;
        labelToggleAll();
        // Open the rest while any folder is still folded, close them all once every
        // one is open — the same rule the notes column's button follows.
        toggleAll.addEventListener('click', function () {
          var open = anyClosed();
          folders.forEach(function (folder) { setOpen(folder, open); });
          labelToggleAll();
          scheduleSpy();
        });
      } else {
        // One folder is its own row; "all" would only restate it.
        if (toggleAll.parentElement) toggleAll.parentElement.removeChild(toggleAll);
      }
    }

    // Paper has no clicks, so a printed export is the whole document: every folder
    // opens for the print and folds back exactly as it was afterwards.
    var foldedForPrint = [];
    window.addEventListener('beforeprint', function () {
      foldedForPrint = folders.filter(function (folder) { return !folder.open; });
      foldedForPrint.forEach(function (folder) { setOpen(folder, true); });
      labelToggleAll();
    });
    window.addEventListener('afterprint', function () {
      foldedForPrint.forEach(function (folder) { setOpen(folder, false); });
      foldedForPrint = [];
      labelToggleAll();
      scheduleSpy();
    });

    // A link into a folded folder has to open it first: the browser would scroll to
    // an element it is not drawing, and land the reader on the folder's row with
    // the card they asked for still hidden.
    function folderAround(node) {
      while (node && node !== document.body) {
        if (node.tagName === 'DETAILS' && node.classList.contains('group')) return node;
        node = node.parentElement;
      }
      return null;
    }

    function targetOf(hash) {
      if (!hash || hash.length < 2) return null;
      try { return document.querySelector(hash); } catch (error) { return null; }
    }

    function jumpTo(target) {
      target.scrollIntoView({ block: 'start' });
      // The pictures above the target claim their box as they decode, so the card
      // moves while the jump is in flight. One frame later the page has its final
      // height: align against that rather than against the folded one.
      window.requestAnimationFrame(function () { target.scrollIntoView({ block: 'start' }); });
    }

    function reveal(hash, fromHistory) {
      var target = targetOf(hash);
      if (!target) return;
      var folder = folderAround(target);
      if (!folder && target.tagName === 'DETAILS' && target.classList.contains('group')) folder = target;
      if (folder) {
        setOpen(folder, true);
        labelToggleAll();
      }
      if (!fromHistory) {
        // A file:// page may refuse a history write; the jump still happens.
        try { history.pushState(null, '', hash); } catch (error) { /* the old hash stays in the address bar */ }
      }
      jumpTo(target);
      scheduleSpy();
    }

    document.addEventListener('click', function (event) {
      var origin = event.target;
      if (!origin || !origin.closest) return;
      var link = origin.closest('a[href^="#"]');
      if (!link) return;

      var hash = link.getAttribute('href');
      var target = targetOf(hash);
      if (!target) return;

      // The rail's folder row is a switch, like the folder's own row: the first
      // click opens the folder, the next one closes it, and the rail follows.
      var entry = link.closest('.toc-group');
      if (entry && link.classList.contains('toc-group-link')) {
        event.preventDefault();
        var folder = targetOf('#' + entry.getAttribute('data-target'));
        if (!folder) return;
        setOpen(folder, !folder.open);
        labelToggleAll();
        if (!folder.open) return;
        try { history.pushState(null, '', '#' + folder.id); } catch (error) { /* as above */ }
        jumpTo(folder);
        scheduleSpy();
        return;
      }

      // Anything else pointing inside a folded folder — a strip in the rail, an
      // anchor a note links to — opens the folder and then jumps.
      var around = folderAround(target);
      if (around && !around.open) {
        event.preventDefault();
        reveal(hash, false);
      }
    });

    window.addEventListener('hashchange', function () { reveal(window.location.hash, true); });

    // A file opened at a link inside it (notes.html#strip-12, or a bookmark) opens
    // the folder before the reader sees anything.
    if (window.location.hash) reveal(window.location.hash, true);

    // ── The contents rail ─────────────────────────────────────────────────
    // The rail follows the reader: the folder above the reading line and the strip
    // above it carry the active mark. Folded cards have no box on the page, so they
    // are no candidates — the mark would otherwise sit on a card nobody is drawing.
    if (!toc) return;
    var strips = Array.prototype.slice.call(document.querySelectorAll('.strip'));
    var LEAD = 120;
    var pendingSpy = false;

    function clear(list, selector) {
      Array.prototype.forEach.call(list, function (item) {
        var target = item.querySelector(selector);
        if (target) target.parentElement.classList.remove('is-active');
      });
    }

    function activeIn(list) {
      var found = null;
      Array.prototype.forEach.call(list, function (item) {
        var box = item.getBoundingClientRect();
        if (box.height === 0) return;
        if (box.top - LEAD <= 0) found = item;
      });
      return found;
    }

    function updateSpy() {
      pendingSpy = false;
      clear(toc.querySelectorAll('.toc-group'), '.toc-group-link');
      clear(toc.querySelectorAll('.toc-strip'), 'a');

      var group = activeIn(folders);
      if (group) {
        var groupLink = toc.querySelector('.toc-group-link[href="#' + group.id + '"]');
        if (groupLink) groupLink.parentElement.classList.add('is-active');
      }

      var strip = activeIn(strips);
      if (strip) {
        var stripLink = toc.querySelector('.toc-strip a[href="#' + strip.id + '"]');
        if (stripLink) stripLink.parentElement.classList.add('is-active');
      }
    }

    function scheduleSpy() {
      if (!toc || pendingSpy) return;
      pendingSpy = true;
      window.requestAnimationFrame(updateSpy);
    }

    window.addEventListener('scroll', scheduleSpy, { passive: true });
    window.addEventListener('resize', scheduleSpy);
    updateSpy();
  })();`;
