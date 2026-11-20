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

/** Idempotent: safe to touch from two components in the same tree. */
export function installMonaco(): typeof monaco {
  if (!installed) {
    installed = true;
    window.MonacoEnvironment = {
      getWorker: () => new EditorWorker(),
    };
    loader.config({ monaco });
  }
  return monaco;
}

export type MonacoEditor = monaco.editor.IStandaloneCodeEditor;
