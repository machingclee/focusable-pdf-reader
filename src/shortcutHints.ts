/**
 * How a chord is written where the app names one in its own UI.
 *
 * The keys themselves are the same on both platforms: `shortcuts.ts` accepts
 * Command or Control as the modifier, so `⌘B` and `Ctrl+B` are one chord. Only
 * its name changes. macOS writes the glyphs the rest of the system uses —
 * `⌘⌥B` — and Windows writes the names its own menus use — `Ctrl+Alt+B`.
 *
 * Hints are composed from these labels rather than written out, so tooltips and
 * the empty state's cheat sheet do not tell a Windows keyboard to press Command
 * or Option. `other` (the plain web build) keeps the macOS glyphs: it has no
 * stronger claim on a layout, and macOS is the one the app was written on.
 */
import { PLATFORM, type Platform } from "./platform";

export type ShortcutLabels = {
  /** Command on macOS, Control on Windows. */
  mod: string;
  /** Option on macOS, Alt on Windows. */
  alt: string;
  /** Shift, a glyph on macOS and a word on Windows. */
  shift: string;
  /** One chord: `⌘⌥B` on macOS, `Ctrl+Alt+B` on Windows. */
  chord: (...keys: string[]) => string;
};

/** The words and the joining rule for one platform. */
export function shortcutLabels(platform: Platform): ShortcutLabels {
  const windows = platform === "windows";
  return {
    mod: windows ? "Ctrl" : "⌘",
    alt: windows ? "Alt" : "⌥",
    shift: windows ? "Shift" : "⇧",
    // macOS runs a chord's glyphs together (`⌘⌥B`); Windows separates key
    // names with `+` (`Ctrl+Alt+B`). A lone key is the same either way.
    chord: (...keys) => keys.join(windows ? "+" : ""),
  };
}

/** The labels for the window this module was loaded in. */
export const SHORTCUT = shortcutLabels(PLATFORM);
