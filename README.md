# PDF Focus Viewer

<img width="1661" height="1280" alt="image" src="https://github.com/user-attachments/assets/ba94c898-559c-4dc7-96d0-d90a7e9d0609" />


A Mac-friendly Tauri PDF reader with trackpad pinch-zoom and a focus-mode reading strip.

When focus mode is on, a horizontal window follows the cursor and shows the page at full brightness. Everything above and below that strip is covered by a 70% dark veil so nearby lines stop competing for attention.

The strip height is set in pixels. Pinch-zooming the page scales that window in proportion, so the same amount of PDF content stays visible.

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
- Drag the **Strip** slider to change the current on-screen height; further zoom keeps that height proportional. The last strip size is remembered.

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
| Strip taller / shorter | `]` / `[` (`⌘` doubles the step, shift ×3) |
# focusable-pdf-reader
