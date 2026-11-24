# PDF Focus Viewer

<img width="142" height="142" alt="Square142x142Logo" src="https://github.com/user-attachments/assets/3f0d63ac-6825-456a-aaaf-ee1df35bed48" />


https://github.com/user-attachments/assets/1a3b9f97-35ef-4eca-9f08-70de75a2414d

A Mac-friendly Tauri PDF reader built around a focus-mode reading strip: a sharp horizontal window over the page, everything else under a dark, blurred veil, and markdown notes saved on the passages you frame.

## Features

Read the article for what the app does — the focus-mode reading strip, highlights, the docked notes column, cross-note references and HTML export:

[PDF Reader: Focus Mode Reading and Study Notes Taking](https://www.machingclee.com/portfolio/PDF-Reader:-Focus-Mode-Reading-and-Study-Notes-Taking)

## Window chrome

There is no native title bar on either platform; the same 34px strip at the top of the window ([TitleBar.tsx](src/components/TitleBar.tsx)) is the app's only bar, and dragging it moves the window.

- **macOS** keeps its traffic lights and nothing else: `titleBarStyle: "Overlay"` plus `hiddenTitle: true` in [tauri.conf.json](src-tauri/tauri.conf.json) leaves them floating over the strip, so the strip reserves a gutter for them.
- **Windows** has no such setting, so the caption — icon, title, minimise / maximise / close — is taken out of the window style in Rust ([win32.rs](src-tauri/src/win32.rs)): `WS_CAPTION` off, `WS_THICKFRAME` kept, which leaves resizing, snapping and the drop shadow native while the caption disappears. The three buttons are drawn by the app instead ([WindowControls.tsx](src/components/WindowControls.tsx)), at the corner Windows puts them in. DWM still paints the few pixels of the caption frame above the webview, so `win32.rs` colours both the caption and border to `--bg-elev`; otherwise that strip shows the system accent as a light line across the top.

The app menu is macOS-only ([appMenu.ts](src/appMenu.ts)). On macOS `Menu.setAsAppMenu` lands in the system menu bar; on Windows the same call puts a native, light menu bar *inside* the window, above the webview. That bar is not the caption and survives `WS_CAPTION` removal, so it is skipped there — the app's own toolbar and key handlers cover the same commands.

The platform is read once in [platform.ts](src/platform.ts) and published as `data-os` on `<html>`, which is what the stylesheet's two paddings key off.

The full investigation — the native menu, the DWM caption frame, and the two recipes for removing the frame completely (`decorations: false` or `WM_NCCALCSIZE`) — is in [docs/windows-app-bar.md](docs/windows-app-bar.md).

## Run

```bash
npm install                          # frontend
cd backend && bun install && cd ..   # backend (Bun + Express + Prisma)
yarn dev                             # both: backend on :4317, app via vite on :1420
```

`yarn dev` runs the backend and the Tauri app with one lifetime, so Ctrl-C stops both. To run the halves yourself, use `npm run dev:backend` and `npm run dev:tauri`.

On Windows the bash script does not apply — it needs `lsof` and POSIX process groups — so [dev-win.ps1](dev-win.ps1) runs the same two steps from PowerShell:

```bash
yarn dev:win                 # or: bun run dev:win
```

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
| Open a PDF | `⌘O` / `Ctrl+O` |
| Open in a new window | `⌘N` / `Ctrl+N` |
| Find | `⌘F` |
| Focus mode on / off | double-click a paragraph, `⌘` + drag, `F`, or `Esc` |
| Highlight the strip / the paragraph under the pointer | `H`, or right-click → Highlight |
| Step back one layer (menu → search → notes panel → strip) | `Esc` |
| Zoom in / out, fit width | `⌘+` / `⌘-`, `⌘0` |
| Strip taller / shorter | `]` / `[` |
| Move strip | `↑` / `↓` |
| Undo / redo | `⌘Z` / `⌘Y`, or `⌘⇧Z` |
| PDF tab / Notes tab | `⌘1` / `⌘2` |
