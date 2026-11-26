/**
 * Which document F2 or Enter should rename, kept free of React and of the DOM
 * so the decision can be tested without a window.
 *
 * The documents column is a list: the highlighted row is the one a key renames,
 * and a key that lands on a row renames that row. Enter is also how a text
 * field, a folder control and the notes pane do their own work, so those keep
 * the key.
 */

export type RenameShortcutTarget = {
  key: string;
  repeat: boolean;
  composing: boolean;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** The key's target is inside the documents column. */
  inColumn: boolean;
  /** Focus is on the page itself, after a press that did not land on a control. */
  focusOnPage: boolean;
  /** The last pointer press was inside the documents column. */
  columnActive: boolean;
  /** A menu or a popover is already using the keyboard. */
  blocked: boolean;
  /** The target is a button or link other than a document row. */
  foreignControl: boolean;
  /** A text field already has the key. */
  editing: boolean;
  /** The document row the key landed on, when it landed on one. */
  rowId: number | null;
  /** The highlighted document, used when the key did not land on a row. */
  selectedId: number | null;
  /** Whether that document is currently shown in the column. */
  isVisible: (id: number) => boolean;
};

/**
 * The document to rename, or null when the key belongs to something else.
 *
 * A row under the key wins over the highlight, so tabbing onto another document
 * and pressing Enter renames that one. A press in the column that left focus on
 * the page — a folder heading, the column's empty space — still renames the
 * highlighted document. A press anywhere else does not.
 */
export function documentIdForRenameShortcut(target: RenameShortcutTarget): number | null {
  if (target.blocked || target.editing || target.foreignControl) return null;
  if (target.repeat || target.composing) return null;
  if (target.key !== "F2" && target.key !== "Enter") return null;
  if (target.meta || target.ctrl || target.alt || target.shift) return null;
  if (!target.inColumn && !(target.columnActive && target.focusOnPage)) return null;
  const id = target.rowId ?? target.selectedId;
  if (id === null || !target.isVisible(id)) return null;
  return id;
}
