/**
 * What the stage shows when there is no page on it: the spinner while a document
 * is being opened, and the invitation when nothing is open at all.
 *
 * The invitation is the app's only explanation of itself — what the strip does,
 * what it is for, and every key that reaches it — so it is written out here once
 * rather than growing inside the stage's JSX.
 */
import { ShortcutKeys } from "../ShortcutKeys";
import { IS_WINDOWS } from "../../platform";
import { SHORTCUT } from "../../shortcutHints";
import type { RecentDoc } from "../../prefs";
import { useAppSelector } from "../../store/hooks";
import { selectRecents } from "../../store/slices/documentSlice";

/**
 * Whether a path is one of the app's own library copies.
 *
 * Every imported document lives in `<app data>/library/<sha256>.pdf`, and that
 * path is never what the reader recognises a book by — the original path is, and
 * that is what the backend stores as `original_path`.
 */
function isLibraryPath(path: string): boolean {
  return /[/\\]library[/\\]/.test(path);
}

export type EmptyDocumentProps = {
  /** A document is being opened: say so rather than offering the invitation. */
  busy: boolean;
  onOpenPicker: () => void;
  onOpenRecent: (doc: RecentDoc) => void;
};

export function EmptyDocument({ busy, onOpenPicker, onOpenRecent }: EmptyDocumentProps) {
  // The documents already read are the document slice's; the list is shown here
  // because this is where a reader with nothing open would look for it.
  const recents = useAppSelector(selectRecents);
  if (busy) {
    return (
      <div className="empty" role="status">
        <div className="pdf-opening">
          <span className="spinner" aria-hidden />
          <p>Opening PDF…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="empty">
      <div className="empty-card">
        <h1>Read one line at a time.</h1>
        <p>
          Open a PDF, pinch to zoom, then double-click a paragraph to park
          the reading strip around that block. Right-click the strip to save
          it as a record for this document. The strip rides the page as
          you scroll, so it stays on the passage it was parked on.
          Everything else sits under a 70% veil.
        </p>
        <button className="primary" onClick={() => onOpenPicker()}>
          Choose a PDF
        </button>
        {recents.length > 0 && (
          <div className="recent-list">
            <div className="recent-heading">Recent documents</div>
            {recents.map((doc) => (
              <button
                key={`${doc.openedAt}-${doc.path ?? doc.name}`}
                className="ghost recent-item"
                disabled={!doc.path}
                onClick={() => doc.path && onOpenRecent(doc)}
              >
                <span title={doc.name}>{doc.name}</span>
                {/* A library path is the app's own copy named by its
                hash: worth opening, meaningless to read, so the
                row shows the name alone. */}
                {doc.path && !isLibraryPath(doc.path) && (
                  <em title={doc.path}>{doc.path}</em>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="hints">
          <div>Drop a PDF anywhere · <ShortcutKeys keys={[SHORTCUT.mod, "O"]} /> to open</div>
          <div>Double-click a paragraph to focus · <kbd>{SHORTCUT.mod}</kbd>{IS_WINDOWS ? "+" : " "}drag to draw the strip · right-click the band to save it as a note · <kbd>H</kbd> toggles the highlight pen · right-click → Toggle highlight · middle-drag to pan · drag a border to resize · <kbd>Esc</kbd> closes the strip first · <kbd>F</kbd> toggle · <kbd>T</kbd> pages</div>
          <div><ShortcutKeys keys={[SHORTCUT.mod, "F"]} /> find · <ShortcutKeys keys={[SHORTCUT.mod, "B"]} /> pages · <ShortcutKeys keys={[SHORTCUT.mod, SHORTCUT.alt, "B"]} /> notes of this PDF</div>
          <div><kbd>[</kbd> <kbd>]</kbd> strip · <kbd>{SHORTCUT.chord(SHORTCUT.alt, "[")}</kbd> 1 pt · <kbd>{SHORTCUT.chord(SHORTCUT.alt, "↑")}</kbd> 1px · <kbd>{SHORTCUT.chord(SHORTCUT.mod, "[")}</kbd> ×3 · <kbd>↑</kbd> <kbd>↓</kbd> move</div>
        </div>
      </div>
    </div>
  );
}
