# PDF Focus Viewer

https://github.com/user-attachments/assets/1a3b9f97-35ef-4eca-9f08-70de75a2414d

A Mac-friendly Tauri PDF reader built around a focus-mode reading strip: a sharp horizontal window over the page, everything else under a dark, blurred veil, and markdown notes saved on the passages you frame.

## Features

Read the article for what the app does — the focus-mode reading strip, highlights, the docked notes column, cross-note references and HTML export:

[PDF Reader: Focus Mode Reading and Study Notes Taking](https://www.machingclee.com/portfolio/PDF-Reader:-Focus-Mode-Reading-and-Study-Notes-Taking)

## Run

```bash
npm install                          # frontend
cd backend && bun install && cd ..   # backend (Bun + Express + Prisma)
yarn dev                             # both: backend on :4317, app via vite on :1420
```

`yarn dev` runs the backend and the Tauri app with one lifetime, so Ctrl-C stops both. To run the halves yourself, use `npm run dev:backend` and `npm run dev:tauri`.

The backend serves its Swagger UI at <http://127.0.0.1:4317/api-docs> and its command/event graph at <http://127.0.0.1:4317/event-storming>.

In development the frontend reads the port from `VITE_BACKEND_PORT` in `.env.development`. A packaged build starts the backend as a sidecar with `PORT=0`, reads the `BACKEND_READY port=<n>` line it prints, and hands the port to the webview. `VITE_BACKEND_URL` overrides both. `npm test` runs the Bun tests; the API test starts a throwaway backend.

## Bundle

```bash
yarn bundle                  # backend sidecar, then frontend + Rust + .app/.dmg
yarn bundle --bundles app    # same, without the (slow) dmg step
yarn bundle:frontend         # rebuild the frontend only, reusing the sidecar on disk
```

[bundle.sh](bundle.sh) compiles the backend with `bun build --compile` into `src-tauri/binaries/pdf-backend-<triple>`, then runs `tauri build`. Extra arguments are forwarded to `tauri build`, e.g. `yarn bundle --target universal-apple-darwin`. Outputs land in `src-tauri/target/release/bundle/macos/`.

On Windows, use [bundle.ps1](bundle.ps1) instead — it runs the same two steps from PowerShell and builds the NSIS setup and MSI:

```bash
yarn bundle:win                  # NSIS setup + MSI
yarn bundle:win --bundles nsis   # skip the MSI (no WiX, faster)
```

Outputs land in `src-tauri/target/release/bundle/nsis/` and `.../msi/`.

Local builds are ad-hoc signed, which is enough to run the app on this machine. Signing and notarization are necessary only to hand the `.dmg` to someone else.

## Shortcuts

| Action | Keys |
| --- | --- |
| Open a PDF | `⌘O` |
| Find | `⌘F` |
| Focus mode on / off | double-click a paragraph, `⌘` + drag, `F`, or `Esc` |
| Step back one layer (menu → search → notes panel → strip) | `Esc` |
| Zoom in / out, fit width | `⌘+` / `⌘-`, `⌘0` |
| Strip taller / shorter | `]` / `[` |
| Move strip | `↑` / `↓` |
| Undo / redo | `⌘Z` / `⌘Y`, or `⌘⇧Z` |
| PDF tab / Notes tab | `⌘1` / `⌘2` |
