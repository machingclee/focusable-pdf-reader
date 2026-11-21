# PDF Focus Viewer

https://github.com/user-attachments/assets/1a3b9f97-35ef-4eca-9f08-70de75a2414d

A Mac-friendly Tauri PDF reader with trackpad pinch-zoom and a focus-mode reading strip.

When focus mode is on, a horizontal reading window sits over the page. Everything above and below the strip sits under a 70% dark veil with an adjustable blur, and the reading hole stays sharp. Saved strips carry markdown notes, and one backend serves the viewer, the docked notes column and the Notes tab.

## Demos

### Current Build

The video above shows the current build: the reading strip, the note badges, the docked notes column and the HTML export.

### The Early Version

https://github.com/user-attachments/assets/99676710-5356-4e44-ba75-ddeb8a65b1f3

Kept because it shows the one job the app started with: a strip that follows the cursor, parked by dragging the gold-edged band. No notes, no backend.

## Run

```bash
npm install                          # frontend
cd backend && bun install && cd ..   # backend (Bun + Express + Prisma)
yarn dev                             # both: backend on :4317, app via vite on :1420
```

`yarn dev` runs `bun --watch` and the Tauri app with one lifetime, so Ctrl-C stops both. To run the two halves yourself, use `npm run dev:backend` and `npm run dev:tauri`.

In development the frontend reads the port from `VITE_BACKEND_PORT` in `.env.development`. A packaged build starts the backend as a sidecar with `PORT=0`, reads the `BACKEND_READY port=<n>` line it prints, and hands the port to the webview. `VITE_BACKEND_URL` overrides both.

```bash
npm test              # Bun tests; the API test starts a throwaway backend
```

## Bundle

```bash
yarn bundle                  # backend sidecar, then frontend + Rust + .app/.dmg
yarn bundle --bundles app    # same, without the (slow) dmg step
yarn bundle:frontend         # rebuild the frontend only, reusing the sidecar on disk
```

`yarn bundle` ([bundle.sh](bundle.sh)) compiles the backend with `bun build --compile` into `src-tauri/binaries/pdf-backend-<triple>`, then runs `tauri build`. The sidecar build runs first, so a backend failure stops the run before the Rust build, and it is the same binary `bundle.externalBin` embeds. `beforeBuildCommand` runs only `npm run build`, so `tauri build` never touches the backend.

Outputs land in `src-tauri/target/release/bundle/macos/*.app` and `.../dmg/*.dmg`. Extra arguments are forwarded to `tauri build`, e.g. `yarn bundle --target universal-apple-darwin`.

To exercise the real startup path, run the packed app, which spawns the backend with `PORT=0` and keeps its own database:

```bash
open "src-tauri/target/release/bundle/macos/PDF Focus Viewer.app"
ls ~/Library/Application\ Support/com.machingclee.pdf-focus-viewer/database.db
```

Local builds are ad-hoc signed, which is enough to run the app on this machine. Signing and notarization are necessary only to hand the `.dmg` to someone else.

## Use

- Open a PDF with `⌘O`, or drop a file onto the window. The last document reopens at launch, and `Recents` jumps back to other files.
- The app keeps its own copy of every PDF it opens, under `library/` in its data folder, and reads only that copy — opening the same file from two places is one document with one set of notes, and moving, renaming or deleting the original leaves it alone.
- Use the pages rail on the left to preview and jump, and drag its right edge to resize it.
- Pinch on the trackpad to zoom toward the cursor, or use `⌘` plus scroll.
- `⌘F` finds text, and `Enter` / `Shift+Enter` walk the matches.
- Double-click a paragraph to turn the strip on around that block, or hold `⌘` and drag to draw it over any area.
- Click anywhere outside the band to turn the strip off. `F`, `Focus` and `Esc` still work.
- `Scroll` (default) keeps the strip on a page location as the page scrolls. `Fixed` parks it at a screen height.
- Set the height with `[` / `]` or the `Strip` slider, and the veil blur with the `Blur` slider. Both values are remembered.
- A note badge at the left of the page marks a passage that carries a remark. Click the badge to open that note, or double-click it to put the strip on that passage.
- The chip at the foot of the pages rail shows whether the backend answers. Click it to open the Swagger UI at `/api-docs`.

`Esc` closes everything in one press: the band's menu, the search bar, the notes column and the strip. The note popup and an active note field keep their own `Esc`.

## Notes

Strips that carry a note are saved through the backend, and each note is markdown. The docked column shows the cards beside the page without replacing it, and the Notes tab lists every document and its strips in two panes. A card can be renamed, reordered between folders, edited in place, exported, or moved into its own window, which closes back into the viewer.

`Export HTML` writes the strips on screen to one self-contained page and opens it in the browser. A snapshot of each strip is painted from the PDF, and a document that has moved still exports its notes as text.

The frontend talks to the backend through RTK Query slices, and mutations invalidate tags so every surface refreshes from one write.

## Shortcuts

| Action | Keys |
| --- | --- |
| Open | `⌘O` |
| Focus mode | double-click a paragraph, `⌘` + drag, or `F` |
| Leave focus mode | click outside the band, or `F` |
| Close everything | `Esc` |
| Pages rail | `T` |
| Find | `⌘F` |
| Next / previous match | `Enter` / `Shift+Enter` |
| Zoom in / out, fit width | `⌘+` / `⌘-`, `⌘0` |
| Strip taller / shorter | `]` / `[` (`⌥` 1 pt, `⌘` or `⇧` ×3) |
| Move strip | `↑` / `↓` (one strip height, `⌥` 1 px) |
| Scroll / Fixed lock | toolbar `Scroll` / `Fixed` |
| Note popup: save / cancel | `⌘S` / `Esc` |
| PDF tab / Notes tab | `⌘1` / `⌘2` |
