/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Port the backend listens on during `vite dev`, where the backend is started
   * by hand (`npm run dev:backend` -> `bun --watch`, default 4317).
   * Ignored in production builds: there the port is handed over by Rust.
   */
  readonly VITE_BACKEND_PORT?: string;
  /**
   * Full backend base URL, e.g. `http://127.0.0.1:4317`. Wins over
   * `VITE_BACKEND_PORT` and also works in a production build, which is handy
   * when loading the built frontend in a browser against a backend you started
   * yourself. Leave empty for the packaged app.
   */
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
