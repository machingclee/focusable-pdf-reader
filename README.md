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
- **Windows** has no such setting, so the window is created *undecorated* there — `decorations: false` + `shadow: true` in [tauri.windows.conf.json](src-tauri/tauri.windows.conf.json) for the main window, and the same pair in [windowBridge.ts](src/windowBridge.ts) for the windows opened at runtime. An undecorated Tauri window keeps `WS_THICKFRAME`, so resizing, snapping, the drop shadow and the rounded corners stay native, while the client area starts at the window's top edge: the strip is the first row of the window, not the second one. [win32.rs](src-tauri/src/win32.rs) then clears `WS_CAPTION` — which is what shrinks the residual frame from 8 px to 2 px — paints that frame in `--bg-elev`, and tints DWM's border to match. The three buttons are drawn by the app instead ([WindowControls.tsx](src/components/WindowControls.tsx)), at the corner Windows puts them in.

The app menu is macOS-only ([appMenu.ts](src/appMenu.ts)). On macOS `Menu.setAsAppMenu` lands in the system menu bar; on Windows the same call puts a native, light menu bar *inside* the window, above the webview. That bar is not the caption and survives `WS_CAPTION` removal, so it is skipped there — the app's own toolbar and key handlers cover the same commands.

The platform is read once in [platform.ts](src/platform.ts) and published as `data-os` on `<html>`, which is what the stylesheet's two paddings key off.

How the window is framed on each platform — and why the app now occupies the whole window on Windows, including the corner the close button sits in — is in [docs/windows-window-frame.md](docs/windows-window-frame.md). The investigation that came before it, the native menu bar and the two removal strategies as proposals, is in [docs/windows-app-bar.md](docs/windows-app-bar.md).

## Run

```bash
npm install                          # frontend
cd backend && bun install && cd ..   # backend (Bun + Express + Prisma)
bun dev                              # macOS/Linux: both, one lifetime (Ctrl-C stops both)
bun dev:win                          # Windows: the same two steps, from PowerShell
```

`bun dev` (macOS/Linux) runs the backend and the Tauri app with one lifetime, so Ctrl-C stops both. On Windows the bash script does not apply — it needs `lsof` and POSIX process groups, which do not exist there — so [dev-win.ps1](dev-win.ps1) runs the same two steps from PowerShell and keeps the contract with a job object instead: `bun dev:win`, from any shell.

To run the halves yourself, use `npm run dev:backend` and `npm run dev:tauri`.

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
| Toggle the highlight pen | `H`, or right-click → Toggle highlight |
| Thinner / thicker highlight brush | `[` / `]` while the pen is down |
| Annotation tool (pin text anywhere) | `A`, or right-click → Add annotation here |
| Step back one layer (strip → event log → menu → find → notes column) | `Esc` |
| Zoom in / out, fit width | `⌘+` / `⌘-`, `⌘0` |
| Strip taller / shorter | `]` / `[` |
| Move strip | `↑` / `↓` |
| Undo / redo | `⌘Z` / `⌘Y`, or `⌘⇧Z` |
| PDF tab / Dashboard tab | `⌘1` / `⌘2` |
| Pages rail / notes column | `⌘B` / `⌘⌥B` |
| Notes in a window of their own | `⌘⌥⇧B` |
