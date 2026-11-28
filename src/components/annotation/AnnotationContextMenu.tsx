/**
 * The right-click menu for one annotation on the page.
 *
 * A pin is a small target with a lot behind it: the text it holds, the place it
 * stands on, the reference a note can point at, and the row itself. So the menu is
 * opened by right-clicking the pin at any time — unlike a highlight, which offers
 * its delete only while the pen is armed, because a stroke has no identity of its
 * own to press. A pin does: it is a thing standing on the page, and a right-click
 * that lands on it is about it.
 *
 * **Edit with preview** is the pin's writing in the popup the notes column uses
 * (`AnnotationMarkdownDialog`): the markdown and its rendered preview side by
 * side, because the writing is markdown and the page only shows the result. The
 * double-click on the pin is still the small correction, made in place
 * (`AnnotationInlineEditor`); this is the one to reach for when the writing itself
 * is being worked on.
 *
 * There is no **Move** item: the pin is a drag handle by default (`PageAnnotation`),
 * so the gesture is the press and the drag, and letting go is what places it. A menu
 * entry would be a second way to say the same thing, and a worse one — the reader
 * would pick it and then still have to drag.
 *
 * **Text size** is the one edit with no gesture of its own: the writing is drawn at
 * whatever size the row holds, and a margin note beside a dense page and one beside
 * a loose page want different sizes. It is a **slider**, and its middle is the size
 * a pin starts at — left is smaller, right is bigger, and the same travel either way
 * is the same change. The track is dragged freely; the row is written once, when the
 * hand lets go, so one drag is one history step and not one per stop.
 *
 * The floating shell (portal, edge clamping, dismissal) lives in `ContextMenu`;
 * this file only says what an annotation's menu holds.
 */
import { ContextMenu, ContextMenuSeparator } from "../ContextMenu";
import { AnnotationFontSlider } from "./AnnotationFontSlider";

export function AnnotationContextMenu({
  x,
  y,
  fontPt,
  onFontPreview,
  onFontSize,
  onEditWithPreview,
  onCopyReference,
  onDelete,
  onClose,
}: {
  /** Viewport coordinates of the pointer. */
  x: number;
  y: number;
  /** The type size this pin's writing is drawn at, in PDF points. */
  fontPt: number;
  /** Draw the writing at `fontPt` while the track is dragged; nothing is written. */
  onFontPreview: (fontPt: number) => void;
  /** Take the writing's type size to `fontPt`; the row keeps it. */
  onFontSize: (fontPt: number) => void;
  /** Open the writing in the markdown-and-preview popup. */
  onEditWithPreview: () => void;
  onCopyReference: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <ContextMenu x={x} y={y} label="Annotation actions" onClose={onClose}>
      {/* The size has no other surface: the writing is drawn at it and says nothing
          about it, so the menu carries it as a track. */}
      <AnnotationFontSlider fontPt={fontPt} onPreview={onFontPreview} onCommit={onFontSize} />
      <ContextMenuSeparator />
      <button
        type="button"
        className="strip-menu-item"
        role="menuitem"
        onClick={onEditWithPreview}
      >
        Edit with preview
      </button>
      <button type="button" className="strip-menu-item" role="menuitem" onClick={onCopyReference}>
        Copy as reference
      </button>
      <ContextMenuSeparator />
      {/* Deleting a pin is not the destructive case a note or a folder is: the text
          and its place are one edit, `⌘Z` brings it back under the same id, and a
          reference already pasted into a note keeps working. So the item says what
          it does and does it, the same way a highlight's does. */}
      <button
        type="button"
        className="strip-menu-item is-danger"
        role="menuitem"
        onClick={onDelete}
      >
        Delete annotation
      </button>
    </ContextMenu>
  );
}
