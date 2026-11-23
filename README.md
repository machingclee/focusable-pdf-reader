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

The backend also draws its own graph. The diagram now lives in the
[`@machingclee/express-cqrs`](../express-cqrs) package (`event-storming/`
there, served from the copy inside the package), so this project no longer builds
it: `yarn dev` simply reports its URL —
<http://127.0.0.1:4317/event-storming>, the same page the Swagger UI documents as
`GET /docs/command-flow`.

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

The event-storming diagram is the one thing the sidecar cannot read from disk: `bun build --compile` embeds JavaScript, not the `event-storming/public` folder inside `@machingclee/express-cqrs`. `bundle.resources` in [tauri.conf.json](src-tauri/tauri.conf.json) copies that folder into the bundle as `Contents/Resources/event-storming`, and [lib.rs](src-tauri/src/lib.rs) points `EVENT_STORMING_DIR` at it when it starts the sidecar. `bundle.sh` fails early if the installed package does not carry the build.

Outputs land in `src-tauri/target/release/bundle/macos/*.app` and `.../dmg/*.dmg`. Extra arguments are forwarded to `tauri build`, e.g. `yarn bundle --target universal-apple-darwin`.

To exercise the real startup path, run the packed app, which spawns the backend with `PORT=0` and keeps its own database:

```bash
open "src-tauri/target/release/bundle/macos/PDF Focus Viewer.app"
ls ~/Library/Application\ Support/com.machingclee.pdf-focus-viewer/{database,audit}.db
```

Local builds are ad-hoc signed, which is enough to run the app on this machine. Signing and notarization are necessary only to hand the `.dmg` to someone else.

## Use

- Open a PDF with `⌘O`, or drop a file onto the window. The last document reopens at launch, and `Recents` jumps back to other files.
- The app keeps its own copy of every PDF it opens, under `library/` in its data folder, and reads only that copy — opening the same file from two places is one document with one set of notes, and moving, renaming or deleting the original leaves it alone.
- Use the pages rail on the left to preview and jump, and drag its right edge to resize it.
- Pinch on the trackpad to zoom toward the cursor, or use `⌘` plus scroll.
- Opening the notes column keeps the page's share of the window: it scales to the narrower page area instead of being squeezed into it, and the passage at the top of the view stays where it is.
- `⌘F` finds text, and `Enter` / `Shift+Enter` walk the matches.
- Double-click a paragraph to turn the strip on around that block, or hold `⌘` and drag to draw it over any area.
- Leave focus mode with `Esc`, `F` or the `Focus` button — a click in the dark veil beside the band no longer turns the strip off, so reaching for a word outside the hole keeps your place.
- The strip rides the page as you scroll: it is parked on a passage, not at a screen height, so what it frames stays what you were reading.
- Set the height with `[` / `]` or the `Strip` slider, and the veil blur with the `Blur` slider. Both values are remembered.
- A note badge at the left of the page marks a passage that carries a remark. Click the badge to open that note, or double-click it to put the strip on that passage.
- The notes column and the Notes tab have a filter field in the list's tools row, just left of `Expand all`: type to keep only the notes whose markdown contains what you typed. Every word has to appear, in any order; quoted text stays a phrase, and case and line breaks do not matter. What is matched is the note, not the PDF text the strip was saved over. Folders with no match are left out, every group with one is shown open, dragging pauses until the filter is cleared, and `Esc` or the field's `×` puts the list back.
- The chip at the foot of the pages rail shows whether the backend answers. Click it to open the Swagger UI at `/api-docs`.
- There is no native title bar, so the top of the window is the handle: drag the title strip, or any part of the toolbar row that is not a control, to move the window. Double-click either row to zoom it, as a title bar would.

`Esc` steps back one layer per press: the band's menu, then the search bar, then the notes column, then the strip. So the column closes first and the reading strip only goes on a second press. The note popup, an active note field and the notes filter field keep their own `Esc`: the filter empties itself, and the column stays.

## Notes

Strips that carry a note are saved through the backend, and each note is markdown. The docked column shows the cards beside the page without replacing it, and the Notes tab lists every document and its strips in two panes. A card can be renamed, reordered between folders, edited in place, exported, or moved into its own window, which closes back into the viewer.

One note can point at another. **Copy as reference** in a strip's menu puts `[note:12]` on the clipboard; pasted into any note's markdown, that text renders as the strip it names — its page, its band of the PDF and its own note — nested inside the note that mentions it. The reference is resolved by id through RTK Query (`GET /focusable-strips/:id`), so it works from another document, from a card whose list is not loaded and from the note popup. Alone on a line it draws the full card; inside a sentence it stays a chip naming the page. Clicking it opens a **viewer window of its own** on the document the note belongs to — the same viewer, its own pages and zoom — with the pages rail folded, the reading strip parked on that note's band and its notes column open beside the page, the note's card selected and scrolled to there. The passage is read in place, and the window the reader was in is left exactly as it was. Every click is an independent window, so following the same reference twice is two looks rather than one window moved twice. A note that points back at one already open above it is drawn as a line of text rather than followed again, and a reference to a deleted note says so.

`Export HTML` writes the strips on screen to one self-contained page and opens it in the browser. A snapshot of each strip is painted from the PDF, and a document that has moved still exports its notes as text. While a filter is on, the export is the matching notes — the list on screen — rather than the whole document. The page keeps the folder structure and opens with every folder closed: each row is a folder's name, its strip count and a chevron, and a click unfolds its cards. The contents rail folds with them, a link into a closed folder opens it first, `Expand all` opens every folder at once, and printing unfolds them all so no note is left off the paper.

The frontend talks to the backend through RTK Query slices, and mutations invalidate tags so every surface refreshes from one write. There is more than one window now — the docked column, its popped-out window, and a viewer window per reference — and each has its own cache: a write the backend accepted announces itself from the API's own base query — the seam every request goes through, so no endpoint has to remember to do it — as one Tauri notification, and every other window answers by invalidating its whole tag list and refetching what it is showing. It is a local backend, so a few extra GETs per write buy a window that can never quietly show yesterday's note.

Every write goes through an in-process command bus. The backend records each command and its domain events in an `event_audit` table, and serves the resulting command/query/event graph at `/docs/commands`.

Styling is hand-written CSS (`src/App.css`, one theme of tokens). Tailwind is installed beside it for utilities only — `src/tailwind.css` imports the `utilities` layer and **not** preflight, so nothing in the existing CSS is reset, and its scan is narrowed with `source(none)` plus an explicit `@source` for the files that wear a class. So far that is one thing: the `animate-mark` wobble a marked note card plays — `translate`/`rotate` only, so it cannot reflow the list.

## Shortcuts

| Action | Keys |
| --- | --- |
| Open | `⌘O` |
| Focus mode | double-click a paragraph, `⌘` + drag, or `F` |
| Leave focus mode | `Esc`, `F`, or the `Focus` button |
| Step back one layer (menu → search → notes panel → strip) | `Esc` |
| Pages rail | `T` |
| Find | `⌘F` |
| Filter the notes list (with its cards in focus) | `⌘F` |
| Clear the notes filter | `Esc`, or the field's `×` |
| Next / previous match | `Enter` / `Shift+Enter` |
| Zoom in / out, fit width | `⌘+` / `⌘-`, `⌘0` |
| Strip taller / shorter | `]` / `[` (`⌥` 1 pt, `⌘` or `⇧` ×3) |
| Move strip | `↑` / `↓` (one strip height, `⌥` 1 px) |
| Note popup: save / cancel | `⌘S` / `Esc` |
| PDF tab / Notes tab | `⌘1` / `⌘2` |
