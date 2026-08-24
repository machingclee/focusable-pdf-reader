# PDF Focus Viewer

<img width="1661" height="1280" alt="image" src="https://github.com/user-attachments/assets/ba94c898-559c-4dc7-96d0-d90a7e9d0609" />


A Mac-friendly Tauri PDF reader with trackpad pinch-zoom and a focus-mode reading strip.

When focus mode is on, a horizontal window follows the cursor and shows the page at full brightness. Everything above and below that strip is covered by a 70% dark veil so nearby lines stop competing for attention.

The strip height is set in PDF points. One point is one CSS pixel at 100% zoom, so `50 pt` always covers the same slice of the page. Pinch-zooming scales the window on screen in proportion; the number you set does not change.

## Run

```bash
cd 2026-08-23-tauri-pdf-focus-viewer
npm install
npm run tauri dev
```

## Use

- **Open PDF** or drop a file onto the window
- The last document reopens automatically; use **Recents** to jump back to other files
- Use the **Pages** rail on the left to preview pages and jump to one; drag its right edge to resize
- **Pinch on the trackpad** to zoom toward the cursor (`⌘`/`Ctrl` + scroll also works)
- **⌘F** searches the document, highlights every match on a page, and Next/Prev jumps between them
- **Double-click a line** to turn on the reading strip at that spot; **F** or **Focus** still toggles it
- Drag the gold-edged strip to park it on another line. The page does not scroll while you drag.
- Drag the **Strip** slider, or use `[` / `]`, to set the window height in PDF points. Zooming the page keeps that coverage. The last strip size is remembered.

## Focus strip

The strip is a horizontal reading window. Everything above and below it sits under a 70% dark veil. Double-click a line (or press **F**) to turn it on at that spot. It stays locked to that place on the page as you scroll or zoom.

Height is stored in PDF points (`10`–`640` pt). `1 pt` is `1` CSS pixel at 100% zoom, so `50 pt` always covers the same slice of the page. The on-screen hole grows and shrinks with pinch-zoom; the number you set does not.

### Resize

`]` makes the strip taller. `[` makes it shorter. These keys work even when focus mode is off; they change the remembered size.

| Keys | Step |
| --- | --- |
| `[` / `]` | `12 pt` |
| `⌥[` / `⌥]` | `1 pt` |
| `⌘[` / `⌘]` or `⇧[` / `⇧]` | `36 pt` (`12 × 3`) |
| `⌘⇧[` / `⌘⇧]` | `108 pt` (`12 × 3 × 3`) |

The **Strip** slider in the toolbar is the same control: it edits PDF points, not screen pixels.

### Move

With focus mode on, the strip can be moved without scrolling the page.

- Drag the gold-edged band. Grab anywhere on the bright window and pull it up or down. It parks on the page content under the pointer.
- `↓` / `↑` jumps by one full strip height (the current on-screen hole).
- `⌥↓` / `⌥↑` nudges by `1` screen pixel for fine placement.

Dragging and the arrow keys only move the window. They do not change its height.

## Shortcuts

| Action | Keys |
| --- | --- |
| Open | `⌘O` |
| Focus mode | Double-click a line, or `F` |
| Pages rail | `T` |
| Find | `⌘F` |
| Next / previous match | `Enter` / `Shift+Enter` (`⌘G` / `⇧⌘G`) |
| Zoom in / out | `⌘+` / `⌘-` |
| Fit width | `⌘0` |
| Strip taller / shorter | `]` / `[` (`⌥` 1 pt, `⌘` or `⇧` ×3) |
| Move strip | drag the band, or `↑` / `↓` (one strip height, `⌥` 1 px; does not scroll) |
# focusable-pdf-reader
