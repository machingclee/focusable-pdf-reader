/**
 * Whether a key press is the reader writing rather than a shortcut.
 *
 * The viewer binds bare letters (`F`, `T`, `H`, `A`, `[`, `]`), so anything with a
 * caret in it has to own its own keys: a note's field, the find box, the page
 * jump, a tag filter. A content-editable counts too — the markdown editor is one.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}
