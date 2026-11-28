import { describe, expect, test } from "bun:test";
import {
  INDENTED_CODE_SOURCE,
  isIndentedCodeRule,
  noteMarkdownStates,
} from "../src/markdown/noteMarkdownGrammar";

const indentedCode = [new RegExp(INDENTED_CODE_SOURCE), "string"] as const;
const link = [/(!?\[)((?:[^\]\\])*)(\])/, "string.link"] as const;
const emphasis = [/\*([^*])+\*/, "emphasis"] as const;

describe("noteMarkdownStates", () => {
  test("an indented paragraph is not a code string", () => {
    // Four spaces under a numbered item is how a paragraph stays in the item.
    // Monaco's grammar called that a code block and painted the line salmon.
    const { root } = noteMarkdownStates([indentedCode, { include: "@linecontent" }], [emphasis]);
    expect(root.some(isIndentedCodeRule)).toBe(false);
    expect(root).toContainEqual({ include: "@linecontent" });
  });

  test("a note reference is claimed before the link rule can paint it", () => {
    const { linecontent } = noteMarkdownStates([], [link, emphasis]);
    expect(linecontent[0][0]).toBeInstanceOf(RegExp);
    expect(String(linecontent[0][0])).toBe(String(/\[note:[1-9]\d*(?:\?width=[1-9]\d*)?\]/));
    expect(linecontent[0][1]).toBe("");
    expect(linecontent).toContain(link);
  });

  test("the note reference pattern matches the forms a note actually stores", () => {
    const pattern = noteMarkdownStates([], []).linecontent[0][0] as RegExp;
    expect("[note:78]".match(pattern)?.[0]).toBe("[note:78]");
    expect("[note:78?width=599]".match(pattern)?.[0]).toBe("[note:78?width=599]");
    // A link, and a reference that has not been closed yet, are left to the
    // grammar's own rules.
    expect("[label](https://example.com)".match(pattern)).toBeNull();
    expect("[note:78".match(pattern)).toBeNull();
  });
});
