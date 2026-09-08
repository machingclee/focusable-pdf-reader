import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { TauriClickToComponent } from "./components/TauriClickToComponent";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {import.meta.env.DEV && <TauriClickToComponent />}
    <App />
  </React.StrictMode>,
);
