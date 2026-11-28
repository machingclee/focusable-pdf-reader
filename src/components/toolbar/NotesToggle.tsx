/**
 * The notes column's button, pinned to the right edge of the toolbar.
 *
 * Its own control because it opens a panel rather than changing the page, so it
 * should not read as part of the zoom/find cluster. Popped out, it is pressed
 * either way — the notes are on screen, just in another window — and its click
 * raises that window instead of toggling a column that is not here.
 */
import { ListTree } from "lucide-react";
import { useAppSelector } from "../../store/hooks";
import { selectPageCount } from "../../store/slices/documentSlice";
import { selectNotesDetached, selectNotesOpen } from "../../store/slices/panelsSlice";
import { SHORTCUT } from "../../shortcutHints";
import { useViewerCommands } from "../app/viewerCommands";

export function NotesToggle() {
  const enabled = useAppSelector(selectPageCount) > 0;
  const open = useAppSelector(selectNotesOpen);
  const detached = useAppSelector(selectNotesDetached);
  const { toggleNotesPanel } = useViewerCommands();
  const onScreen = open || detached;

  return (
    <button
      className={`ghost notes-toggle${onScreen ? " active" : ""}`}
      onClick={() => toggleNotesPanel()}
      aria-pressed={onScreen}
      disabled={!enabled}
      title={`Notes of this PDF — saved strips beside the page (${SHORTCUT.chord(SHORTCUT.mod, SHORTCUT.alt, "B")}, or ${SHORTCUT.chord(SHORTCUT.mod, SHORTCUT.alt, SHORTCUT.shift, "B")} in a window)`}
    >
      <ListTree size={14} />
      <span className="notes-toggle-label">Notes of this PDF</span>
    </button>
  );
}
