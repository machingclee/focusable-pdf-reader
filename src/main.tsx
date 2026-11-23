import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import App from "./App";
import DetachedNotesApp from "./DetachedNotesApp";
import { TauriClickToComponent } from "./components/TauriClickToComponent";
import { store } from "./store/store";
import { PLATFORM } from "./platform";
import { isNotesWindow } from "./windowBridge";
// Utilities only, and no preflight — see the file. Imported here rather than from
// `App.css` so both roots (viewer and the popped-out notes window) get it once.
import "./tailwind.css";

/**
 * One bundle, two roots.
 *
 * The popped-out notes window loads the same `index.html`, so there is no second
 * Vite entry to keep in sync; `?view=notes` is the whole difference. Each webview
 * evaluates this module for itself, which is why one module-level `store` is one
 * store per window rather than a shared one.
 */
const Root = isNotesWindow() ? DetachedNotesApp : App;

// Which window chrome the strip wears, for the stylesheet's benefit: the
// traffic-light gutter and the Windows window buttons are the same 34px strip
// with different contents, and CSS can only pick between them if the platform
// is on the document. Set before the first render, so the window never paints
// the macOS gutter and then closes it up.
document.documentElement.dataset.os = PLATFORM;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Provider store={store}>
      {import.meta.env.DEV && <TauriClickToComponent />}
      <Root />
    </Provider>
  </React.StrictMode>,
);
