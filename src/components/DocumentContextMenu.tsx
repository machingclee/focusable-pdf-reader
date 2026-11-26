/**
 * The right-click menu for a row in the Notes document list.
 *
 * Open PDF makes that document the one on screen. Open PDF in new window opens
 * it beside this one, in a viewer of its own, leaving what is already on screen
 * exactly where it is. Rename closes the menu and the row replaces its name with
 * the field. Edit tags opens the assignment popover. Copy tags and Paste tags
 * move a tag set from one document to another: a paste is an overwrite, so the
 * item says which document it would take the tags from. Delete takes two clicks,
 * the same way a folder or a strip does, and the armed label says when the
 * document's strips go with it. The shell is the shared one, so this menu is
 * portalled and clamped like the others.
 */
import { ContextMenu, ContextMenuDeleteItem, ContextMenuSeparator } from "./ContextMenu";

export type DocumentContextMenuProps = {
  /** Viewport coordinates of the pointer. */
  x: number;
  y: number;
  /** The document's name, shown so the menu says which row it acts on. */
  name: string;
  /** Strips stored on it, which are deleted along with the document. */
  stripCount: number;
  /** Tags on it; with none there is nothing for Copy tags to take. */
  tagCount: number;
  /**
   * The copy waiting for a paste, or null when nothing has been copied yet: the
   * menu names its source, because a paste replaces this document's tags with
   * that document's.
   */
  pasteSource: string | null;
  /** Show this document's PDF in the viewer. */
  onOpen: () => void;
  /**
   * Open this document in a viewer window of its own, or undefined when this
   * build has no second window (the plain web build), where the item says so
   * rather than disappearing.
   */
  onOpenInNewWindow?: () => void;
  onRename: () => void;
  /** Open the tag assignment popover for this row. */
  onTags: () => void;
  /** Take this row's tags, to be pasted onto another document. */
  onCopyTags: () => void;
  /** Replace this row's tags with the copied ones. */
  onPasteTags: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function DocumentContextMenu({
  x,
  y,
  name,
  stripCount,
  tagCount,
  pasteSource,
  onOpen,
  onOpenInNewWindow,
  onRename,
  onTags,
  onCopyTags,
  onPasteTags,
  onDelete,
  onClose,
}: DocumentContextMenuProps) {
  return (
    <ContextMenu x={x} y={y} label={`Actions for ${name}`} onClose={onClose}>
      <p className="strip-menu-note is-heading is-name-label" role="none">
        {name}
      </p>
      <button type="button" className="strip-menu-item" role="menuitem" onClick={onOpen}>
        Open PDF
      </button>
      <button
        type="button"
        className="strip-menu-item"
        role="menuitem"
        disabled={!onOpenInNewWindow}
        title={
          onOpenInNewWindow
            ? "Open this PDF in a window of its own, leaving this one as it is."
            : "Only the desktop app can open a second window."
        }
        onClick={onOpenInNewWindow}
      >
        Open PDF in new window
      </button>
      <ContextMenuSeparator />
      <button type="button" className="strip-menu-item" role="menuitem" onClick={onRename}>
        Rename
      </button>
      <ContextMenuSeparator />
      <button type="button" className="strip-menu-item" role="menuitem" onClick={onTags}>
        Edit tags
      </button>
      {/* A disabled item still says what the feature is and why it cannot run
          here, which a missing item cannot. */}
      <button
        type="button"
        className="strip-menu-item"
        role="menuitem"
        disabled={tagCount === 0}
        title={tagCount === 0 ? "This document has no tags to copy." : undefined}
        onClick={onCopyTags}
      >
        Copy tags
      </button>
      <button
        type="button"
        className="strip-menu-item"
        role="menuitem"
        disabled={pasteSource === null}
        title={
          pasteSource === null
            ? "Copy a document's tags first."
            : `Replace this document's tags with the ones copied from “${pasteSource}”.`
        }
        onClick={onPasteTags}
      >
        Paste tags
      </button>
      <ContextMenuSeparator />
      <ContextMenuDeleteItem
        label="Delete document"
        armedLabel={
          stripCount > 0
            ? `Delete document and its ${stripCount} strip${stripCount === 1 ? "" : "s"} — click again`
            : "Delete this document — click again"
        }
        onConfirm={onDelete}
      />
    </ContextMenu>
  );
}
