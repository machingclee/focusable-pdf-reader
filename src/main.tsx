import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import App from "./App";
import DetachedNotesApp from "./DetachedNotesApp";
import { TauriClickToComponent } from "./components/TauriClickToComponent";
import { store } from "./store/store";
import { isNotesWindow } from "./windowBridge";

/**
 * One bundle, two roots.
 *
 * The popped-out notes window loads the same `index.html`, so there is no second
 * Vite entry to keep in sync; `?view=notes` is the whole difference. Each webview
 * evaluates this module for itself, which is why one module-level `store` is one
 * store per window rather than a shared one.
 */
const Root = isNotesWindow() ? DetachedNotesApp : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Provider store={store}>
      {import.meta.env.DEV && <TauriClickToComponent />}
      <Root />
    </Provider>
  </React.StrictMode>,
);
