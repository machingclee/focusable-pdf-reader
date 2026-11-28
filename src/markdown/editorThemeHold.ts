/**
 * Monaco keeps one theme for every editor on the page. `setTheme` paints them
 * all, and the editor that mounted last is the one whose colours stick — including
 * after it has gone.
 *
 * Each editor holds the theme it wants for as long as it is mounted. The highest
 * priority hold is the one on screen (the latest, when two priorities match), and
 * letting go puts the next hold back. The note popup can therefore wear its dark
 * theme while it is open, and the card's editor returns to its own colours when
 * the popup closes.
 */

export type ThemeHold = {
  theme: string;
  /** A larger number wins over a smaller one for as long as both are held. */
  priority: number;
};

/** Highest priority, and the latest one when two priorities match. */
export function activeHeldTheme(holds: readonly ThemeHold[]): string | null {
  let best: ThemeHold | null = null;
  for (const hold of holds) {
    if (!best || hold.priority >= best.priority) best = hold;
  }
  return best?.theme ?? null;
}

/**
 * The theme a `setTheme` call should actually apply.
 *
 * `@monaco-editor/react` calls `setTheme` itself whenever an editor is created.
 * Once any editor is holding a theme, that call must not replace it: the card's
 * editor is created while the popup is open often enough that its own `setTheme`
 * would paint the popup — and the popup's `setTheme` is what leaves the card dark.
 * With nothing held, the call stands, so the first editor still gets its theme.
 */
export function themeAfterSetTheme(requested: string, held: string | null): string {
  return held ?? requested;
}

export function createEditorThemeHolds(apply: (theme: string) => void) {
  const holds: ThemeHold[] = [];

  const applyActive = () => {
    const theme = activeHeldTheme(holds);
    if (theme) apply(theme);
  };

  return {
    /** The theme that should be on screen, or null when no editor is holding one. */
    active: () => activeHeldTheme(holds),
    hold(theme: string, priority = 0) {
      const entry: ThemeHold = { theme, priority };
      holds.push(entry);
      applyActive();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const index = holds.indexOf(entry);
        if (index >= 0) holds.splice(index, 1);
        applyActive();
      };
    },
  };
}
