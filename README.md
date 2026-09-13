# PDF Focus Viewer

https://github.com/user-attachments/assets/99676710-5356-4e44-ba75-ddeb8a65b1f3



A Mac-friendly Tauri PDF reader with trackpad pinch-zoom and a focus-mode reading strip.

When focus mode is on, a horizontal reading window sits over the page. Everything above and below that strip is covered by a 70% dark veil with an adjustable backdrop blur so nearby lines stop competing for attention. The reading hole stays sharp.

By default the strip is **Scroll**: it is locked to a place on the page and rides along as you scroll. Switch to **Fixed** to park it at a screen height while the page moves underneath.

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
- **Double-click a paragraph** to turn on the reading strip around that block (from its first line to the next paragraph break); **F** or **Focus** still toggles it at the last size
- **Scroll** (default) keeps the strip on that page location as you scroll. **Fixed** parks it at a screen height
- Drag the gray band to move the window. Drag the **top or bottom border** to resize (the opposite edge stays put). The page does not scroll while you drag.
- Drag the **Strip** slider, or use `[` / `]`, to set the window height in PDF points. Zooming the page keeps that coverage. The last strip size is remembered.
- Drag the **Blur** slider to set the veil’s backdrop-filter radius (`0`–`25` px, default `5` px). The hole stays sharp. The last blur is remembered.

## Focus strip

The strip is a horizontal reading window. Everything above and below it sits under a 70% dark veil with a backdrop blur. Double-click a paragraph to size the window from that block’s first line to the next paragraph break. Press **F** to toggle at the last size.

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

## Shortcuts

| Action | Keys |
| --- | --- |
| Open | `⌘O` |
| Focus mode | Double-click a paragraph, or `F` |
| Pages rail | `T` |
| Find | `⌘F` |
| Next / previous match | `Enter` / `Shift+Enter` (`⌘G` / `⇧⌘G`) |
| Zoom in / out | `⌘+` / `⌘-` |
| Fit width | `⌘0` |
| Strip taller / shorter | `]` / `[` (`⌥` 1 pt, `⌘` or `⇧` ×3) |
| Move strip | drag the band, or `↑` / `↓` (one strip height, `⌥` 1 px; does not scroll) |
| Scroll / Fixed lock | toolbar **Scroll** / **Fixed** |
| Resize from an edge | drag the top or bottom border of the band |
