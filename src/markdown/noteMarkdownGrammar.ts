/**
 * Monaco's built-in markdown grammar is a rough sketch of the language, and two
 * of its rules paint ordinary note text in the string colour (the salmon one).
 *
 * A line indented by a tab or four spaces is taken for a code block, the whole
 * line one `string` token. A paragraph under a numbered item is indented that
 * way on purpose — it belongs to the item — and the real parser (remark) keeps
 * it a paragraph. The editor was the only place it turned red. Retokenizing the
 * line into one string span also drops an IME composition, so the line that
 * just turned red stops accepting input.
 *
 * `[note:12]` and `[note:12?width=240]` are the other one. The grammar's link
 * rule matches any `[...]`, so a note reference is a `string.link` and turns the
 * same colour the moment the closing bracket is typed.
 */

/** The monarch rule Monaco uses for a 4-space or tab-indented code line. */
export const INDENTED_CODE_SOURCE = String.raw`^(\t|[ ]{4})[^ ].*$`;

/**
 * A note reference, as plain text rather than a link.
 *
 * The token is empty so the theme's ordinary foreground is used: the popup is
 * dark and the card is paper-green, and a named token would have to pick one.
 */
export const NOTE_REFERENCE_RULE = [/\[note:[1-9]\d*(?:\?width=[1-9]\d*)?\]/, ""] as const;

type MonarchRule = readonly unknown[] | { readonly include?: string };

export function isIndentedCodeRule(rule: MonarchRule): boolean {
  if (!Array.isArray(rule)) return false;
  const pattern = rule[0];
  return pattern instanceof RegExp && pattern.source === INDENTED_CODE_SOURCE;
}

/**
 * The markdown states a note editor should tokenize with.
 *
 * `root` loses the indented-code rule. `linecontent` gains the note reference
 * ahead of the link rule, which would otherwise still match `[note:…]`.
 */
export function noteMarkdownStates<T extends MonarchRule>(
  root: readonly T[],
  linecontent: readonly T[],
): { root: T[]; linecontent: T[] } {
  return {
    root: root.filter((rule) => !isIndentedCodeRule(rule)),
    linecontent: [NOTE_REFERENCE_RULE as unknown as T, ...linecontent],
  };
}
