import { describe, expect, test } from "bun:test";
import { filterNotes, noteMatchesQuery, parseNoteQuery } from "../src/noteFilter";
import type { FocusableStrip, FolderWithStrips } from "../src/types/dto";

const strip = (id: number, remark: string, folderId: number | null = null): FocusableStrip => ({
  id,
  pdf_document_id: 1,
  folder_id: folderId,
  ordering: id,
  page_number: id,
  top: 0,
  height: 10,
  left: 0,
  width: 10,
  page_width: 100,
  page_height: 200,
  text_excerpt: null,
  remark,
  highlights: "[]",
  created_at: 0,
});

const folder = (id: number, strips: FocusableStrip[]): FolderWithStrips => ({
  id,
  pdf_document_id: 1,
  name: `Folder ${id}`,
  ordering: id,
  created_at: 0,
  focusable_strips: strips,
});

describe("parseNoteQuery", () => {
  test("splits on whitespace and ignores case", () => {
    expect(parseNoteQuery("  Strip   BAND ")).toEqual(["strip", "band"]);
  });

  test("keeps a quoted phrase together", () => {
    expect(parseNoteQuery('"reading band" strip')).toEqual(["reading band", "strip"]);
  });

  test("collapses the whitespace inside a phrase", () => {
    expect(parseNoteQuery('"reading \t band"')).toEqual(["reading band"]);
  });

  test("keeps a half-typed phrase rather than dropping it", () => {
    expect(parseNoteQuery('"reading band')).toEqual(["reading band"]);
  });

  test("has nothing to filter on for an empty or blank field", () => {
    expect(parseNoteQuery("")).toEqual([]);
    expect(parseNoteQuery("   \t\n")).toEqual([]);
    expect(parseNoteQuery('""')).toEqual([]);
  });
});

describe("noteMatchesQuery", () => {
  const terms = (...words: string[]) => parseNoteQuery(words.join(" "));

  test("keeps everything when there is no query", () => {
    expect(noteMatchesQuery("anything at all", [])).toBe(true);
  });

  test("ignores case and the layout of the whitespace", () => {
    expect(noteMatchesQuery("The Reading\n\nBand", terms("reading band"))).toBe(true);
  });

  test("finds the words of a heading without its hashes", () => {
    expect(noteMatchesQuery("## Reading note", terms("reading note"))).toBe(true);
  });

  test("finds a word that the emphasis syntax splits", () => {
    expect(noteMatchesQuery("**bo**ld", terms("bold"))).toBe(true);
  });

  test("finds a word inside a fenced code block", () => {
    expect(noteMatchesQuery("```ts\nconst band = 1;\n```", terms("band"))).toBe(true);
  });

  test("finds link text, and a URL that only the markdown has", () => {
    expect(noteMatchesQuery("see [the spec](x.md)", terms("the spec"))).toBe(true);
    expect(noteMatchesQuery("see [the spec](https://example.com/a)", terms("example.com"))).toBe(true);
  });

  test("finds an identifier whose underscores the flattening drops", () => {
    expect(noteMatchesQuery("call `snake_case` first", terms("snake_case"))).toBe(true);
  });

  test("matches across a line break as a phrase", () => {
    expect(noteMatchesQuery("first line\nsecond line", terms('"line second"'))).toBe(true);
  });

  test("requires every term, not just one", () => {
    expect(noteMatchesQuery("only the strip", terms("strip band"))).toBe(false);
    expect(noteMatchesQuery("the strip and its band", terms("strip band"))).toBe(true);
  });

  test("does not match a word that is not there", () => {
    expect(noteMatchesQuery("nothing relevant", terms("band"))).toBe(false);
  });
});

describe("filterNotes", () => {
  const folders = [
    folder(1, [strip(10, "the reading band", 1), strip(11, "a different idea", 1)]),
    folder(2, [strip(20, "nothing to do with it", 2)]),
  ];
  const unfiled = [strip(30, "band notes from no folder"), strip(31, "elsewhere")];

  test("returns the list untouched when there is no filter", () => {
    const result = filterNotes(folders, unfiled, []);
    expect(result.folders).toBe(folders);
    expect(result.unfiled).toBe(unfiled);
    expect(result.matched).toBe(5);
    expect(result.total).toBe(5);
  });

  test("keeps only the matching notes and drops folders left with none", () => {
    const result = filterNotes(folders, unfiled, parseNoteQuery("band"));
    expect(result.folders.map((item) => item.id)).toEqual([1]);
    expect(result.folders[0]?.focusable_strips.map((item) => item.id)).toEqual([10]);
    expect(result.unfiled.map((item) => item.id)).toEqual([30]);
    expect(result.matched).toBe(2);
    expect(result.total).toBe(5);
  });

  test("passes a folder through unchanged when all of its notes match", () => {
    const all = [folder(3, [strip(40, "band", 3), strip(41, "another band", 3)])];
    const result = filterNotes(all, [], parseNoteQuery("band"));
    expect(result.folders[0]).toBe(all[0]);
  });

  test("leaves the source lists alone", () => {
    filterNotes(folders, unfiled, parseNoteQuery("band"));
    expect(folders[0]?.focusable_strips).toHaveLength(2);
    expect(unfiled).toHaveLength(2);
  });

  test("has nothing to show when no note matches", () => {
    const result = filterNotes(folders, unfiled, parseNoteQuery("zebra"));
    expect(result.folders).toEqual([]);
    expect(result.unfiled).toEqual([]);
    expect(result.matched).toBe(0);
    expect(result.total).toBe(5);
  });

  test("matches the note, not the PDF text the strip was saved over", () => {
    const excerptOnly = strip(50, "");
    excerptOnly.text_excerpt = "the reading band";
    const result = filterNotes([folder(5, [excerptOnly])], [], parseNoteQuery("band"));
    expect(result.matched).toBe(0);
  });
});
