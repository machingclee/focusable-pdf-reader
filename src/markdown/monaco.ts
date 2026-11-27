/**
 * Monaco boots once, from here.
 *
 * Two things have to happen before the first editor instance is created, which
 * is why this module is imported for its side effects by the editor component
 * rather than called from a React effect (an effect runs after Monaco has
 * already tried to spawn its worker):
 *
 * 1. `loader.config({ monaco })` points `@monaco-editor/react` at the copy in
 *    `node_modules`. Its default is a CDN — a packaged Tauri app has no network
 *    and offline dev would silently get two Monaco copies.
 * 2. `MonacoEnvironment.getWorker` gives the editor its worker. Notes are
 *    markdown, which has no language server, but the editor worker still backs
 *    things like find-all and diffing; without it the console fills with
 *    "You must define a function MonacoEnvironment.getWorker" and those degrade.
 *
 * Only the plain editor worker is wired: no JSON/CSS/TS language workers are
 * pulled in, so nothing language-specific ships in the bundle.
 */
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { loader } from "@monaco-editor/react";
import { createEditorThemeHolds, themeAfterSetTheme } from "./editorThemeHold";

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

let installed = false;

/**
 * The theme the note popup's editor wears.
 *
 * `vs-dark` paints its surface #1e1e1e, which reads as a hole rather than a field
 * against the app's surfaces, so this theme keeps `vs-dark`'s token colours
 * (`inherit: true`) and lifts the surfaces instead: the editor one step below the
 * dialog it sits in, the widgets and selection a step above it.
 *
 * The hex values are the CSS variables they mirror, repeated rather than read:
 * Monaco themes take colour strings, not custom properties.
 */
export const EDITOR_THEME = "pdf-focus-viewer";

/**
 * The theme the *card's* editor wears.
 *
 * A card is paper-green, and the editor inside it is that paper a step darker: bright
 * enough to keep the card's character, dark enough to read as a field written *in* the
 * card rather than the card itself. Because the surface is light, this theme inherits
 * from `vs` (the light base) rather than `vs-dark` — its token colours are the dark
 * ones a light surface needs, so the markdown reads instead of vanishing.
 *
 * The colours mirror `--notes-card-editor` and the two steps beside it in `App.css`;
 * Monaco takes colour strings and cannot read custom properties, so keep the pairs in
 * step.
 */
export const CARD_EDITOR_THEME = "pdf-focus-viewer-card";

/**
 * The popup covers the page, so its theme wins for as long as it is open.
 * The card's editor stays mounted underneath; when the popup closes, the card's
 * hold is the one left and its colours come back.
 */
export const POPUP_EDITOR_THEME_PRIORITY = 1;
export const CARD_EDITOR_THEME_PRIORITY = 0;

/**
 * One stack for the page. Applying a theme goes through `monaco.editor.setTheme`,
 * which `installMonaco` points back at whatever hold is active — see the guard
 * there for why a direct `setTheme` cannot be trusted once two editors exist.
 */
const themeHolds = createEditorThemeHolds((theme) => {
  installMonaco().editor.setTheme(theme);
});

/** Keep `theme` on screen until the returned function runs (the editor unmounted). */
export function holdEditorTheme(theme: string, priority = 0): () => void {
  return themeHolds.hold(theme, priority);
}

const THEME_COLORS = {
  "editor.background": "#34343a",
  "editorGutter.background": "#34343a",
  "editor.lineHighlightBackground": "#3c3c43",
  "editor.selectionHighlightBackground": "#3f3f47",
  "editorWidget.background": "#3e3e45",
  "editorWidget.border": "#56565f",
  "scrollbarSlider.background": "#ffffff33",
  "scrollbarSlider.hoverBackground": "#ffffff4d",
  "scrollbarSlider.activeBackground": "#ffffff66",
};

/** The card's editor: the card green (#d2e4d7) taken down a step, still bright. */
const CARD_THEME_COLORS = {
  "editor.background": "#b4ccb9",
  "editorGutter.background": "#b4ccb9",
  "editor.lineHighlightBackground": "#c0d6c4",
  "editor.selectionHighlightBackground": "#9fbba8",
  "editorWidget.background": "#c4d9c9",
  "editorWidget.border": "#8ba394",
  // Dark, because the surface is light: light sliders on it would be invisible.
  "scrollbarSlider.background": "#00000026",
  "scrollbarSlider.hoverBackground": "#00000040",
  "scrollbarSlider.activeBackground": "#00000059",
};

/** Idempotent: safe to touch from two components in the same tree. */
export function installMonaco(): typeof monaco {
  if (!installed) {
    installed = true;
    window.MonacoEnvironment = {
      getWorker: () => new EditorWorker(),
    };
    loader.config({ monaco });
    monaco.editor.defineTheme(EDITOR_THEME, {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: THEME_COLORS,
    });
    monaco.editor.defineTheme(CARD_EDITOR_THEME, {
      // The light base: this surface is bright, so the tokens on it must be dark.
      base: "vs",
      inherit: true,
      // The base's own comment green is unreadable on a green surface, and it is the
      // one colour a green page cannot inherit. The rest of the light palette (blue
      // headings, dark red strings) already sits well on it.
      rules: [
        { token: "comment", foreground: "3f5a4c", fontStyle: "italic" },
        { token: "emphasis", fontStyle: "italic" },
        { token: "strong", fontStyle: "bold" },
      ],
      colors: CARD_THEME_COLORS,
    });
    // `@monaco-editor/react` calls `setTheme` when an editor is created, and that
    // call is global: opening the popup repaints the card, and the card's own
    // creation can repaint the popup. Once an editor is holding a theme, a later
    // call keeps that theme instead of replacing it.
    const requested = monaco.editor.setTheme.bind(monaco.editor);
    monaco.editor.setTheme = (themeName: string) => {
      requested(themeAfterSetTheme(themeName, themeHolds.active()));
    };
  }
  return monaco;
}

export type MonacoEditor = monaco.editor.IStandaloneCodeEditor;
