# PDF Focus Viewer

https://github.com/user-attachments/assets/99676710-5356-4e44-ba75-ddeb8a65b1f3



A Mac-friendly Tauri PDF reader with trackpad pinch-zoom and a focus-mode reading strip.

When focus mode is on, a horizontal reading window sits over the page. Everything above and below that strip is covered by a 70% dark veil with an adjustable backdrop blur so nearby lines stop competing for attention. The reading hole stays sharp.

By default the strip is **Scroll**: it is locked to a place on the page and rides along as you scroll. Switch to **Fixed** to park it at a screen height while the page moves underneath.

The strip height is set in PDF points. One point is one CSS pixel at 100% zoom, so `50 pt` always covers the same slice of the page. Pinch-zooming scales the window on screen in proportion; the number you set does not change. Set it with `]` / `[`, or by dragging the top or bottom edge of the band.

## Run

```bash
npm install                      # frontend
cd backend && bun install && cd ..   # backend (Bun + Express + Prisma)
```

In development the backend runs separately, on a fixed port, and the app talks to it.
One command starts both, and they share a lifetime:

```bash
yarn dev              # bun --watch on :4317 + the Tauri app (vite on :1420)
```

Ctrl-C — or simply closing the terminal window — stops both, including the app
window and the Vite dev server, so nothing keeps holding `:4317`. To run the two
halves yourself instead:

```bash
npm run dev:backend   # terminal 1: bun --watch on http://127.0.0.1:4317
npm run dev:tauri     # terminal 2: the Tauri app
```

The frontend reads that port from `VITE_BACKEND_PORT` in `.env.development`. In a
packaged build there is no fixed port: Rust starts the backend as a sidecar with
`PORT=0`, reads the `BACKEND_READY port=<n>` line it prints, and hands the port to
the webview through the `get_backend_info` command and the `backend-ready` event.
`VITE_BACKEND_URL` overrides both, e.g. to point a build at a backend you started
yourself.

```bash
npm test              # Bun tests; the API test starts a throwaway backend
```

## Bundle

```bash
yarn bundle                  # backend sidecar, then frontend + Rust + .app/.dmg
yarn bundle --bundles app    # same, without the (slow) dmg step
yarn bundle:frontend         # rebuild the frontend only, re-bundle with the sidecar already on disk
```

`yarn bundle` ([bundle.sh](bundle.sh)) compiles the backend with `bun build --compile` into
`src-tauri/binaries/pdf-backend-<triple>`, checks that file exists, then runs
`tauri build`. The sidecar build runs first so a backend failure stops the run
before the Rust build, and it is the same binary Tauri's `bundle.externalBin`
embeds.

`yarn bundle:frontend` ([bundle-frontend.sh](bundle-frontend.sh)) is a plain
`tauri build`: it re-bundles with a freshly built frontend and the sidecar that is
already in `src-tauri/binaries/`. Only the app crate recompiles (it re-embeds
`dist/`), not the Rust dependency tree. It fails fast if no sidecar has been built
yet.

`beforeBuildCommand` runs only `npm run build` (tsc + vite), so `tauri build` never
touches the backend. The flip side: a bare `yarn build:exe` does not rebuild the
backend either, so build through `yarn bundle`.

Outputs land in `src-tauri/target/release/bundle/macos/*.app` and
`.../dmg/*.dmg`; both scripts print the paths (and confirm the backend is inside
`Contents/MacOS/`). Any extra arguments are forwarded to `tauri build`, e.g.
`yarn bundle --target universal-apple-darwin`. `npm run bundle` and
`npm run bundle:frontend` do the same thing.

### Trying a packaged build

```bash
yarn bundle --bundles app            # .app only, no (slow) dmg
open "src-tauri/target/release/bundle/macos/PDF Focus Viewer.app"
```

This is the only way to exercise the real startup path: the packed app spawns the
backend with `PORT=0` and discovers the port, which never happens in `tauri dev`.
The packaged app keeps its own data, so it does not share recents or strips with
`backend/prisma/dev.db`:

```bash
ls ~/Library/Application\ Support/com.machingclee.pdf-focus-viewer/database.db
```

To watch the backend's log lines (`[backend] listening on …`,
`BACKEND_READY port=…`), launch the executable from a terminal instead of `open`:

```bash
"src-tauri/target/release/bundle/macos/PDF Focus Viewer.app/Contents/MacOS/tauri-pdf-focus-viewer"
```

Local builds are ad-hoc signed, which is all macOS asks for when the app runs from
this machine. Signing and notarization only become necessary to hand the `.dmg` to
someone else; that is where `bundle.externalBin` pays off, because Tauri signs the
sidecar along with the app.

## Use

- **Open PDF** or drop a file onto the window
- The last document reopens automatically; use **Recents** to jump back to other files
- Use the **Pages** rail on the left to preview pages and jump to one; drag its right edge to resize
- **Pinch on the trackpad** to zoom toward the cursor (`⌘`/`Ctrl` + scroll also works)
- **⌘F** searches the document, highlights every match on a page, and Next/Prev jumps between them
- **Double-click a paragraph** to turn on the reading strip around that block (from its first line to the next paragraph break); **F** or **Focus** still toggles it at the last size
- **Click anywhere outside the band** to turn the strip off again. The band, its right-click menu and the toolbar keep taking clicks, so dragging, resizing and the sliders still work while the strip is up
- **Scroll** (default) keeps the strip on that page location as you scroll. **Fixed** parks it at a screen height
- Drag the gray band to move the window. Drag the **top or bottom border** to resize (the opposite edge stays put). The page does not scroll while you drag.
- Drag the **Strip** slider, or use `[` / `]`, to set the window height in PDF points. Zooming the page keeps that coverage. The last strip size is remembered.
- Drag the **Blur** slider to set the veil’s backdrop-filter radius (`0`–`25` px, default `5` px). The hole stays sharp. The last blur is remembered.
- The **Backend: localhost:4317** chip in the bottom-right corner shows whether the API is answering (green / red dot). Click it to open the backend’s **Swagger UI** in your browser (`/api-docs`), which documents every endpoint.

## Focus strip

The strip is a horizontal reading window. Everything above and below it sits under a 70% dark veil with a backdrop blur. Double-click a paragraph to size the window from that block’s first line to the next paragraph break. Press **F** to toggle at the last size.

### Turn it off

A left click anywhere outside the band leaves focus mode — on the veiled page, on the page rail, on the notes column. That is the gesture whether the strip was double-clicked up, toggled with **F**, or opened from a saved card, and it also makes a double-click elsewhere a *move* rather than a second toggle: the first click clears the old strip, the second parks the new one around the paragraph that was hit. **F**, **Focus** and `Esc` still work.

It is a *click*, not a press, so a gesture that turns into a drag leaves the strip alone: dragging the scrollbar while the strip rides the page, or selecting a sentence, is not a dismissal.

Four surfaces are exempt, because they own the click:

| Surface | Why |
| --- | --- |
| the band and its borders | clicking, dragging or resizing it is not a dismissal |
| the band’s right-click menu | the click that chooses **Save strip** has to reach the menu |
| the toolbar | the **Focus** toggle would dismiss and toggle itself back on, and the **Strip** and **Blur** sliders are adjusted *while* the veil is on screen |
| the note dialog | it is modal and closes on its own terms |

`src/stripDismiss.ts` holds that list, and `dismissesStrip()` decides per click (the middle and right buttons never dismiss: the middle button pans, the right one opens the band’s menu; the second click of a double-click is left to the park handler).

**Scroll** (default) locks the hole to a page location so it rides the document. **Fixed** parks it at a viewport Y so the page slides underneath. The last lock mode is remembered.

Height is stored in PDF points (`10`–`640` pt). `1 pt` is `1` CSS pixel at 100% zoom, so `50 pt` always covers the same slice of the page. The on-screen hole grows and shrinks with pinch-zoom; the number you set does not.

### Resize

`]` makes the strip taller. `[` makes it shorter. These keys work even when focus mode is off; they change the remembered size.

| Keys | Step |
| --- | --- |
| `[` / `]` | `12 pt` |
| `⌥[` / `⌥]` | `1 pt` |
| `⌘[` / `⌘]` or `⇧[` / `⇧]` | `36 pt` (`12 × 3`) |
| `⌘⇧[` / `⌘⇧]` | `108 pt` (`12 × 3 × 3`) |

The **Strip** slider in the toolbar is the same control: it edits PDF points, not screen pixels. Height is remembered even while focus is off.

### Veil blur

The **Blur** slider sets the veil’s `backdrop-filter` radius from `0` to `25` px (default `5` px). Only the dimmed regions blur; the reading hole and toolbox stay sharp. Blur is remembered even while focus is off.

### Move

With focus mode on, the strip can be moved without scrolling the page.

- Drag the gray band (the middle of the bright window) up or down.
- `↓` / `↑` jumps by one full strip height (the current on-screen hole).
- `⌥↓` / `⌥↑` nudges by `1` screen pixel for fine placement.

In **Scroll** mode, that new location stays on the page as you scroll. In **Fixed** mode, it stays at that screen height. Dragging the band and the arrow keys only move the window. They do not change its height.

### Resize from the borders

Drag the **top or bottom border** of the band (`ns-resize`). The opposite edge stays put. The slider and `[` / `]` still change height from the center.

### Save with a note

Right-click the band and choose **Save strip…**. A markdown popup opens over the viewer, and the strip row is only written when you confirm — so **Cancel** or `Esc` leaves the backend untouched, and an error from the backend keeps the popup (and your text) open with the message on top.

The popup has three modes, switchable from the header or the keyboard:

| Mode | What it shows | Keys |
| --- | --- | --- |
| **Edit** | editor only | `⌘⌥B` |
| **Split** (default) | editor and live preview, drag the divider | `⌘⌥B` |
| **Preview** | rendered note only | `⌘B` |

The note is stored as the strip's `remark` (markdown). What the preview understands:

- GFM: tables, task lists (ticking a box rewrites the source), strikethrough, autolinks
- headings, with stable anchors (CJK titles included) and a `[TOC]` block; a contents sidebar appears once the inline block scrolls away
- math via KaTeX: `$inline$` and `$$display$$`
- fenced code with syntax colours and a copy button; inline code copies on click
- images render at any size and can be dragged wider (written back as `?width=`)

While the popup is up it owns the keyboard: `⌘F` finds inside the note (and opens the preview search), `⌘+` / `⌘-` / `⌘0` resize the note text instead of the PDF, and the viewer's shortcuts stay idle.

## Notes of this PDF

The toolbar's **Notes of this PDF** toggle docks the same cards beside the page instead of replacing it: a translucent, blurred column floats over the page, so the strips of the document you are reading stay visible while you read. Clicking a card parks the reading strip on it without leaving the viewer; double-clicking a note edits it in place, and the card menu holds the markdown popup. The panel follows the open document and refreshes itself when a strip is saved or deleted; the same toolbar toggle closes it, as does dragging its left edge all the way in.

Opening the panel registers the PDF in the backend if it was not saved before (the same upsert a saved strip does), because "notes of this PDF" needs the row to hang them on.

Clicking anywhere outside the column dismisses it — the page, the rail, the toolbar, another tab. The column's own subtree is exempt (cards, the inline editor, the card menu, the markdown popup), as is the toolbar toggle, which closes it itself. The dismissal happens on `pointerdown`, so the click that closes the column does not also land on something it was covering.

While the column is open it also outranks the reading strip: an outside click closes the column and leaves the strip alone, where with the column closed the same click would turn the strip off. It is a layer above the page with a dismissal of its own, so the click belongs to it — one click, one close — and picking a card, or putting the caret in the note field a **Save strip** just opened, does not end focus mode. Close the column and the next click outside the band dismisses the strip as usual.

Opening and closing is animated: the column slides in from the right edge over 220 ms (transform only, so the page underneath never reflows), fades in over 160 ms, and reverses on close. It stays mounted so the close can animate, but while closed it is `visibility: hidden` and off-screen, which keeps it out of hit-testing and the accessibility tree. `prefers-reduced-motion` turns the movement off. Dragging its edge shut plays the same close.

The column is resizable: drag its left edge (same 7 px grab strip as the page rail). The width is written once on release, to `app_state` under `notes_panel.width`, and read back at startup — so it survives a restart, and the backend is the store rather than the webview's local storage.

## Notes tab

The **Notes** switch at the top right of the title strip opens the same saved strips the viewer writes, in two panes: every document the backend knows (newest first, with a strip count) on the left, that document's strips on the right. Choosing a document is a click, not a page load.

Each strip is a full-width card: the snapshot of the strip above, the note below it — rendered from its markdown (GFM, math, tables, code, links), not flattened to plain text. The card caps the note's height so a long note stays a summary; the full text is one double-click away. Clicking the card opens the strip in the viewer; **double-clicking the note text edits it in place** — a field appears in the card, `⌘Enter` (or **Save note**) writes it, `Esc` cancels. Right-clicking the card offers **Markdown editor…** and **Delete strip** — one shared `StripContextMenu` for both this tab and the docked column, portalled to `document.body` so the column's slide transform cannot clip or mis-position it (delete asks for a second click, then removes the row from the backend).

Saving a strip no longer opens a dialog: **Save strip** writes the row, opens this column and puts the caret in the new card's note field, so the note is typed where it will be read. Cancelling that field leaves a saved strip with no note, which the list shows as "no note".

- The snapshot is **rendered from the PDF on demand** — the page is drawn small at the card's width and only the strip's band (full page width, its own height) is kept. Nothing is stored in the database, so a thumbnail is exactly as sharp as the document and a strip saved at 400 % looks like one saved at 100 %. Page renders are cached per document (three at a time) and rows only render once they scroll into view.
- The consequence: a document that has moved or been deleted cannot be rendered, and the card falls back to the strip's stored text with the page number.
- The note is rendered from its markdown (GFM, math, tables, code, links) with a compact card type scale; a plain-text flattening of the first ~160 characters is still what feeds the card's tooltip and its "no note" check.
- Clicking a card switches to the PDF tab, opens the document if needed, and parks the reading strip exactly where it was saved. The page scrolls so the strip's own centre lands on the **strip line** — a fifth of the way down the viewport, not the middle — because the reading line wants the rest of the page below it; walking through cards therefore moves the page under a band that stays put. At the first or last page there is no room to scroll that far, and the band rides the strip wherever it lands.
- The card menu's **Markdown editor…** opens the full popup, pre-filled with the stored remark, and writes it back with `PATCH /focusable-strips/:id` — the strip keeps its position and only the note changes.

The popup also draws the strip it belongs to, as a band above the editor: while the note is being written (or rewritten) the passage is on screen, rendered from the page rather than stored.

`⌘1` and `⌘2` switch tabs from either view.

## Data layer

The frontend talks to the backend through **RTK Query**, not a hand-written client:

- `src/store/api/baseApi.ts` resolves the backend address at call time (fixed port in dev, the Rust-provided port when packaged), attaches `X-Backend-Token` from the store, and exposes `apiErrorMessage()` so every component renders failures the same way.
- Three injected slices hold the endpoints: `pdfDocumentApi` (`/pdf-documents`, including the idempotent `getOrCreateDocument` upsert), `focusableStripApi` (`/focusable-strips` with create / remark / delete), and `appStateApi` (`/app-state`, the remembered UI values). Strip endpoints are keyed by the strip id and nothing else — `deleteStrip(id)`, `updateStripRemark({ id, remark })` — because the strip is what the route addresses; the document id only appears where a route needs it (`createStrip`'s body, `listStrips`' filter).
- Endpoints are used as `api.endpoints.someEndpoint.useQuery()`. No slice exports hook aliases — the `endpoints` object is the only entry point, so the endpoint name and the hook name always agree.
- Mutations invalidate tags rather than returning data the caller has to store, so the Notes tab, the docked panel and a card all refresh from one write. There is no refresh counter and no shared list state.
- Components own their own data: `NotesView` queries the document list, `DocumentNotesPanel` resolves the open PDF, `StripList` queries that document's strips and owns the remark/delete mutations and the markdown popup. A host passes only *which* document is on screen, a pending-edit id, and two callbacks (open this strip in the viewer, show this status line).
- Integration tests drive the same endpoints through a real store (`tests/api.test.ts`), with `setBackendTargetOverride()` pointing them at a throwaway backend.

## Shortcuts

| Action | Keys |
| --- | --- |
| Open | `⌘O` |
| Focus mode | Double-click a paragraph, or `F` |
| Leave focus mode | click outside the band, or `F` / `Esc` (with the notes column open, that click closes the column first) |
| Pages rail | `T` |
| Find | `⌘F` |
| Next / previous match | `Enter` / `Shift+Enter` (`⌘G` / `⇧⌘G`) |
| Zoom in / out | `⌘+` / `⌘-` |
| Fit width | `⌘0` |
| Strip taller / shorter | `]` / `[` (`⌥` 1 pt, `⌘` or `⇧` ×3) |
| Move strip | drag the band, or `↑` / `↓` (one strip height, `⌥` 1 px; does not scroll) |
| Scroll / Fixed lock | toolbar **Scroll** / **Fixed** |
| Note popup: save / cancel | `⌘S` / `Esc` |
| Note popup: mode | `⌘B`, `⌘⌥B` |
| PDF tab / Notes tab | `⌘1` / `⌘2` |
| Resize from an edge | drag the top or bottom border of the band |
