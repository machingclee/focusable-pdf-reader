/**
 * One chord in the empty state's cheat sheet.
 *
 * macOS draws each key as its own cap — `<kbd>⌘</kbd><kbd>O</kbd>` — the way
 * the rest of the app writes shortcuts. Windows writes the chord inside a single
 * cap, `Ctrl+O`, the way its own menus do. The caller passes the keys already
 * labelled by `SHORTCUT`, so which words they are is the platform's business.
 */
import { IS_WINDOWS } from "../platform";
import { SHORTCUT } from "../shortcutHints";

export type ShortcutKeysProps = {
  /** Keys of one chord, modifiers first: `[SHORTCUT.mod, "O"]`. */
  keys: string[];
};

export function ShortcutKeys({ keys }: ShortcutKeysProps) {
  if (IS_WINDOWS) return <kbd>{SHORTCUT.chord(...keys)}</kbd>;

  return (
    <>
      {keys.map((key) => (
        <kbd key={key}>{key}</kbd>
      ))}
    </>
  );
}
