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

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

let installed = false;

/**
 * The theme every markdown editor in this app wears.
 *
 * `vs-dark` paints its surface #1e1e1e, which against this app's surfaces
 * (`--bg` #2a2a2e, `--bg-elev` #37373c) reads as a hole rather than a field — a
 * card's editor sits inside a #37373c card and looked like a well in the middle of
 * it. So this theme keeps `vs-dark`'s token colours (`inherit: true`) and lifts
 * the surfaces instead: the editor one step *below* the card it sits in, and the
 * widgets, scrollbars and selection a step above it.
 *
 * The hex values are the CSS variables they mirror, repeated rather than read:
 * Monaco themes take colour strings, not custom properties.
 */
export const EDITOR_THEME = "pdf-focus-viewer";

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
  }
  return monaco;
}

export type MonacoEditor = monaco.editor.IStandaloneCodeEditor;
