/**
 * The monarch grammar Monaco ships for markdown. It has no type declarations;
 * `noteMarkdownGrammar.ts` says which two rules a note editor cannot keep.
 */
declare module "monaco-editor/languages/definitions/markdown/markdown.js" {
  type MonarchRule = readonly unknown[] | { readonly include?: string };

  export const language: {
    tokenizer: {
      root: MonarchRule[];
      linecontent: MonarchRule[];
    } & Record<string, MonarchRule[]>;
  } & Record<string, unknown>;
}
