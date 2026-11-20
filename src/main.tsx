import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import App from "./App";
import { TauriClickToComponent } from "./components/TauriClickToComponent";
import { store } from "./store/store";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Provider store={store}>
      {import.meta.env.DEV && <TauriClickToComponent />}
      <App />
    </Provider>
  </React.StrictMode>,
);
