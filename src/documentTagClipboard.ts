/**
 * The document a set of tags was copied from, waiting for a paste onto another.
 *
 * What travels is the *source*, not the tags: a paste is the server's
 * `CopyPdfTagsCommand`, which reads that document and replaces the target's tags
 * with it. Shipping ids instead would freeze the copy at the moment of the
 * right-click and would need the difference worked out here, where assign and
 * unassign would be two requests that can fail apart.
 *
 * Not the system clipboard: the app writes text to it (`clipboard.ts`) but never
 * reads it, and `clipboard.readText` in a webview needs a permission the app does
 * not ask for.
 *
 * Module state rather than a slice or a prop: the Dashboard tab is mounted only
 * while it is the tab on screen (`App` unmounts it when the reader steps back to
 * the PDF), and a copy has to outlive the menu that made it. One window's copy is
 * one window's paste, like the rest of the Dashboard's view state;
 * `store/api/targetOverride.ts` keeps its own seam the same way.
 */

/** What a copy carries: which document the tags come from, and its name for the wording. */
export type CopiedDocumentTags = {
  documentId: number;
  /** The source's name, for the menu's title and the toast. */
  documentName: string;
};

let copied: CopiedDocumentTags | null = null;

/** Remember this document as the one a paste takes its tags from. */
export function copyDocumentTags(value: CopiedDocumentTags): void {
  copied = value;
}

/** The copy waiting for a paste, or null when nothing has been copied. */
export function copiedDocumentTags(): CopiedDocumentTags | null {
  return copied;
}
