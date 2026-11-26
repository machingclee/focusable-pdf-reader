# Removing the Windows application bar

**Scope.** In this document, “application bar” means the native Windows chrome
that sits above a Tauri/WebView2 app: the caption/title bar, the native app
menu, the resize frame, and the DWM-drawn caption strip. It does **not** mean a
Windows Shell AppBar (`SHAppBarMessage` / a docked taskbar-style window).

This is the write-up of the investigation in this repository. It records what
was actually missing, what the current code does, and the two ways to get a
genuinely borderless window if the remaining native frame must be removed
rather than merely hidden.

## TL;DR — what was missing

There was no single missing flag. Four separate layers had to be understood:

1. **The native app menu.** `Menu.setAsAppMenu()` on Windows attaches a real
   Win32 `HMENU` menu bar **inside** the window. That was the first white strip
   reading `PDF Reader File Edit`. Removing `WS_CAPTION` cannot remove it.
2. **The caption.** `titleBarStyle: "Overlay"` and `hiddenTitle: true` are
   macOS-only. On Windows the caption has to be removed with `WS_CAPTION` (or
   the whole frame with `decorations: false`).
3. **The non-client resize frame.** Removing `WS_CAPTION` leaves
   `WS_THICKFRAME`. Windows still reserves a non-client strip around the
   webview — **7 device pixels on the machine used here** — and DWM paints the
   top part with the caption colour (a pale mint under the active theme). This
   was the second “border at the top”. It is not a CSS border and it is not the
   menu bar.
4. **A frame policy.** Colouring the frame like the title strip makes it
   invisible at rest, and only at rest. Removing it means either turning the
   native frame off (`decorations: false`) or keeping `WS_THICKFRAME` and taking
   over the non-client calculations with `WM_NCCALCSIZE`.

**The repo has since performed (4)**, with `decorations: false`, and found that
it does not cost native resize, shadow or snapping on this Tauri — so the
proposal and trade-off table in
[Complete removal, option A](#6-complete-removal-option-a-decorations-false) are
superseded. The as-built record, with the measurements, is
[windows-window-frame.md](windows-window-frame.md).

### Implementation order

1. Decide whether the app menu is wanted on Windows. If not, gate
   `setAsAppMenu()` at the source — not just at one window.
2. Remove the caption (`WS_CAPTION` off + `SWP_FRAMECHANGED`), or set
   `decorations: false` for the whole frame.
3. Choose the frame policy: keep `WS_THICKFRAME` and tint it (visual only),
   keep it and override `WM_NCCALCSIZE` (physical removal, native behaviour), or
   drop it and add custom resize handles (physical removal, simpler).
4. Add/keep app-drawn window buttons, drag regions, and the matching
   capabilities.
5. If the frame is kept, colour the DWM caption/border to the title strip.
6. Test every window label, DPI, maximized state, and theme.

## 1. What Windows actually stacks above the webview

A normal Tauri window on Windows can contain, from the outside in:

```text
┌─ GetWindowRect ───────────────────────────────────────────────┐
│  DWM rounded corner / 1px border (DWMWA_BORDER_COLOR)         │
│  ┌─ non-client area ────────────────────────────────────────┐ │
│  │  caption (WS_CAPTION): icon, title, min/max/close        │ │  ~31 px
│  │  menu bar (HMENU): File, Edit, …                         │ │  ~26 px
│  │  resize frame (WS_THICKFRAME): invisible grab margin     │ │  ~4–7 px
│  └──────────────────────────────────────────────────────────┘ │
│  ┌─ client area (GetClientRect) ────────────────────────────┐ │
│  │  WebView2 child HWND; React/HTML/CSS live only here      │ │
│  └──────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

The order is not fixed. On this app the original state was:

```text
caption (31 px)
menu bar (26 px)     ← “PDF Reader File Edit”
client area          ← the dark React title strip
```

After stripping `WS_CAPTION` it became:

```text
menu bar (26 px)     ← still there, because it is a separate HMENU
client area
```

After removing the menu it became:

```text
non-client top frame (7 px)  ← DWM caption colour, pale mint
client area                  ← the dark React title strip
```

The white strip changed appearance at each step, which is why it looked like
“the same bar” that would not go away.

### Window rect, client rect, and the diagnostic

For a top-level window, `GetWindowRect` includes the non-client frame;
`GetClientRect` returns only the client size. The client origin in screen
coordinates comes from `ClientToScreen(hwnd, {0,0})`. The non-client thickness
is therefore:

```text
left   = client_origin.x - window_rect.left
top    = client_origin.y - window_rect.top
right  = window_rect.right  - (client_origin.x + client_width)
bottom = window_rect.bottom - (client_origin.y + client_height)
```

On the test machine (Windows 11 25H2, build 26200), for the main window:

```text
window rect        (78, 78) – (1294, 977)   = 1216 × 899
client origin      (85, 85)
client size        1202 × 885
non-client         7 px on every side
```

So the webview genuinely began 7 px below the top edge. No amount of CSS could
paint those 7 px: CSS is inside the client area.

`DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS)` reported
`(84, 78) – (1288, 971)`: 6 px of invisible frame on left/right/bottom, **0 px
on top**. That is the DWM view of the visible window, and it is why the top strip
is special: the top 7 px is treated as a visible caption area rather than an
invisible resize margin.

## 2. Which API owns which layer

| Layer | Owner | Typical symptom | How to remove / change it |
| --- | --- | --- | --- |
| Native caption (`WS_CAPTION`) | Win32 window style | Icon, title, min/max/close above the webview | Clear `WS_CAPTION` and force `SWP_FRAMECHANGED`; or `decorations: false` |
| Native app menu (`HMENU`) | Tauri menu / `muda` | White menu bar reading `PDF Reader File Edit` | Do not call `setAsAppMenu()` on Windows; or `Window::hide_menu` / `remove_menu` |
| Resize frame (`WS_THICKFRAME`) | Win32 window style | 4–8 px invisible grab margin; native resize/snap/shadow | Keep it for native behaviour; remove with `decorations: false`; or override `WM_NCCALCSIZE` |
| DWM caption/border colour | DWM | Pale mint / accent-coloured strip at the top; 1 px border around the window | `DWMWA_CAPTION_COLOR` + `DWMWA_BORDER_COLOR`; only Windows 11 |
| Rounded corners | DWM | Rounding at the top corners, small light fringes | `DWMWA_WINDOW_CORNER_PREFERENCE` (`DWMWCP_DONOTROUND` if unwanted) |
| Client/webview background | WebView2 / Tauri | White flash, white behind the page | `background_color` / CSS on `html, body, #root` |

The important distinction is between **style bits** (Win32), **DWM
attributes**, and **HTML/CSS**. The three operate on different surfaces:

- CSS cannot style the non-client area.
- `WS_CAPTION` does not own the menu bar.
- The menu bar does not own the DWM caption strip.
- `DWMWA_BORDER_COLOR` does not remove the caption strip; it changes a 1 px
  border.

## 3. Why the obvious settings were not enough

### `titleBarStyle: "Overlay"` and `hiddenTitle: true`

Both are macOS-only Tauri settings. Tauri's schema documents them for macOS;
on Windows they are ignored. This project already had them, but they do nothing
for the Windows caption. See
[`tauri.conf.json`](../src-tauri/tauri.conf.json#L21-L23).

`Overlay` is what leaves the macOS traffic lights floating over the content;
`hiddenTitle` hides the title text. Neither changes a Win32 style bit, so the
Windows caption remained.

### `decorations: false`

This is the Tauri flag that removes the native frame. It is the simplest way to
get a genuinely borderless window, but it also removes:

- the resize frame and its hit-testing;
- the native drop shadow;
- Windows snapping;
- the native menu bar;
- the native caption buttons.

The project deliberately did not use it (see
[`win32.rs`](../src-tauri/src/win32.rs#L11-L17)) because it wanted native resize,
snap, and shadow. It is still a valid option if those are rebuilt; see
[Option A](#6-complete-removal-option-a-decorations-false).

### Stripping `WS_CAPTION`

`WS_CAPTION` is not a single window style. It is the combination:

```text
WS_CAPTION = WS_BORDER | WS_DLGFRAME = 0x00C00000
```

Clearing it removes the title, icon, and caption buttons. It does **not**
remove:

- `WS_THICKFRAME` (the resize border);
- `WS_SYSMENU` / `WS_MINIMIZEBOX` / `WS_MAXIMIZEBOX` (which remain as style
  bits even with no caption to draw them);
- the `HMENU` menu bar;
- the DWM caption colour.

That is why the app went from “caption + menu” to “menu” and then to “DWM
caption strip”.

### CSS `border-top`, `padding-top`, `box-shadow`

All of those paint inside the client area. The strip is outside the client
area, so CSS cannot cover it. The CSS titlebar work is still needed for the
app’s own chrome, but it is not a fix for native chrome.

## 4. The actual findings on this app

The measurements below were taken against the running debug build with Python
`ctypes`, and are reproducible with the snippets in
[Diagnostics](#13-appendix-a-diagnostics).

1. **The first white bar was the menu.** It read `PDF Reader`, `File`, `Edit`
   — exactly the three top-level items built in
   [`src/appMenu.ts`](../src/appMenu.ts#L31-L105). The window style already had
   `WS_CAPTION` cleared, and the custom title strip was below it. The strip was
   a native `HMENU` created by `Menu.setAsAppMenu()`. On Windows Tauri assigns
   the app-wide menu to every window by calling `muda`’s
   `init_for_hwnd_with_theme`, which installs the menu bar.
2. **The second bar was the DWM caption area.** After gating the menu to macOS,
   the remaining 7 px top strip:
   - disappeared when `WS_THICKFRAME` was temporarily cleared and
     `SetWindowPos(..., SWP_FRAMECHANGED)` was called;
   - did **not** disappear with `DWMWA_BORDER_COLOR = DWMWA_COLOR_NONE`;
   - turned **red** when `DWMWA_CAPTION_COLOR` was set to red.
   That is conclusive: it is the DWM-painted caption area of the thick frame,
   not the 1 px border and not the menu.
3. **The native caption had already been removed.** Style `0x140f0000` had
   `WS_CAPTION = false`, `WS_THICKFRAME = true`, `WS_SYSMENU = true`. The three
   app-drawn buttons in the React strip were doing the caption buttons’ job.
4. **The title alignment issue was separate.** The titlebar is a flex row:
   a flexible centre pane, then the PDF/Notes switch, then the three window
   buttons. The flex centre pane centres in the **leftover space**, not the
   window. On Windows the right-hand furniture is ~239 px and the left gutter
   is 8 px, so the title sat ~120 px left of centre. On macOS the 88 px
   traffic-light gutter roughly balances the tabs. Fixed with a Windows-only
   flex spacer (see [Current state](#5-current-state-in-this-repo)).

## 5. Current state in this repo

> **Superseded.** This section described the first fix, a colour match on the
> 7 px frame. The frame is now physically removed: the client area starts at the
> window's top edge and what is left of the frame is 2 px of the app's own
> colour. The as-built record is
> [windows-window-frame.md](windows-window-frame.md). The table is kept because
> it is still the accurate description of the other layers.

| Piece | Implementation | Effect |
| --- | --- | --- |
| Native app menu | [`installAppMenu`](../src/appMenu.ts) returns early unless macOS; [`App.tsx`](../src/App.tsx) also skips the focus-install listener | No `HMENU` menu bar on Windows |
| Menu commands | `App.tsx` adds `Ctrl/Cmd+N`; Open, Find, undo/redo already had handlers | No command loss |
| Native caption | `decorations: false` in [`tauri.windows.conf.json`](../src-tauri/tauri.windows.conf.json), then [`strip_caption`](../src-tauri/src/win32.rs#L222-L244) clears `WS_CAPTION` and calls `SetWindowPos(SWP_FRAMECHANGED)` | No caption / native buttons, and a 2 px frame instead of 8 px |
| Residual frame | [`paint_frame`](../src-tauri/src/win32.rs#L173-L200) fills the `WM_NCPAINT` ring; [`apply`](../src-tauri/src/win32.rs#L245-L268) tints `DWMWA_BORDER_COLOR` to `#323237` | A uniform 2 px frame that follows the window's rounded corner |
| Per-window coverage | [`lib.rs`](../src-tauri/src/lib.rs#L309-L331) calls `apply_window_chrome` from `setup` and `on_page_load` | Main, notes, reference viewers, and new app windows |
| Title centering | [`App.css`](../src/App.css#L209) adds a 240 px left spacer on Windows | Title centred in the window above 720 px |

The DWM tint used to be a **colour match**, not a removal, and that is the part
that was wrong: it is only invisible while the strip behind it is the same
colour, which is exactly what a hover or a white page breaks.

## 6. Complete removal, option A: `decorations: false`

This is Tauri’s supported way to remove the native frame. The window becomes
entirely client area; the webview fills it.

### Configuration

Set it for Windows only. Do not put `decorations: false` in the shared
`tauri.conf.json` if macOS should keep its traffic lights.

Runtime, before the window is shown:

```rust
#[cfg(windows)]
if let Some(main) = app.get_webview_window("main") {
    main.set_decorations(false)?;
}
```

Or use a Windows-specific config file. Tauri merges platform configuration over
the base file; repeat the full window object rather than assuming array
elements are merged. This is what the repo now does, in
[`tauri.windows.conf.json`](../src-tauri/tauri.windows.conf.json) — note
`shadow: true`, and note that the file is only read when the build script runs
(it emits `cargo:rerun-if-changed` per config path, so a *new* platform file
needs `build.rs` touched or a `cargo clean` before it takes effect):

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "PDF Focus Viewer",
        "width": 1200,
        "height": 860,
        "minWidth": 720,
        "minHeight": 480,
        "decorations": false,
        "shadow": true
      }
    ]
  }
}
```

Windows created at runtime (the notes column, a note reference, File → Open in
New Window) are not in the config at all; their chrome is merged in one place in
[`windowBridge.ts`](../src/windowBridge.ts#L340-L348).

### What you must rebuild: nothing, on this Tauri

Measured on `tauri 2.11.5` / `tao 0.35.3` / `tauri-runtime-wry 2.11.4`, none of
the following was needed: an undecorated Tauri window keeps `WS_THICKFRAME`, tao
answers `WM_NCCALCSIZE` itself (returning the monitor's work area when
maximized), DWM still rounds the corners and draws the shadow, and tao attaches
a child hit-test window that owns the top edge. The reasoning, and what is left
of the frame (2 px), is in
[windows-window-frame.md §7](windows-window-frame.md#7-what-did-not-have-to-be-rebuilt).

The list is kept as the checklist for a Tauri/tao upgrade, and as the shape of
the work if an older tao is ever pinned:

- **Resize.** Add eight fixed-position hit areas (N, NE, E, SE, S, SW, W, NW),
  about 6–8 px wide, and call
  `getCurrentWindow().startResizeDragging(direction)` on pointer down.
- **Drag.** Keep `data-tauri-drag-region="deep"` on the title strip and the
  `core:window:allow-start-dragging` capability.
- **Window buttons.** Already custom in `WindowControls`.
- **Shadow.** The native shadow would be gone. A CSS shadow inside the window
  cannot cast outside it; accept the loss or use DWM theming.
- **Snapping.** Native snapping is tied to the resize frame; without tao's
  handling it would be gone.
- **Menu.** `decorations: false` removes the frame, not necessarily the
  `HMENU`; gate the app menu separately (section 8).

A minimal resize handle:

```tsx
import { getCurrentWindow, type ResizeDirection } from "@tauri-apps/api/window";

function ResizeEdge({ direction, className }: { direction: ResizeDirection; className: string }) {
  return (
    <div
      className={className}
      onPointerDown={(event) => {
        event.preventDefault();
        void getCurrentWindow().startResizeDragging(direction).catch(console.error);
      }}
    />
  );
}
```

```css
.resize-edge { position: fixed; z-index: 100; }
.resize-edge.n  { top: 0; left: 8px; right: 8px; height: 6px; cursor: ns-resize; }
.resize-edge.e  { top: 8px; right: 0; bottom: 8px; width: 6px; cursor: ew-resize; }
/* …and the other six edges/corners */
```

Required capability (add to
[`default.json`](../src-tauri/capabilities/default.json)):

```json
"core:window:allow-start-resize-dragging"
```

### Trade-offs

As measured, not as expected:

| Keeps | Still costs |
| --- | --- |
| Native resize hit-testing (the non-client ring tao leaves, plus tao's top-edge child window) | A 2 px frame of the app's own colour — the DWM border plus the 1 px ring tao's inset leaves. To get 1 px, `WM_NCCALCSIZE` has to be overridden (option B), which desynchronises tao's inner-size model; see [windows-window-frame.md §10](windows-window-frame.md#10-why-the-frame-is-2-px-and-not-1-px) |
| Native drop shadow | Paint for the ring and the border: a `WM_NCPAINT` subclass and `DWMWA_BORDER_COLOR` |
| Windows snap | A platform config file that restates the whole window object |
| Simple CSS layout (no resize handles, no extra capabilities) | Two places to set `decorations: false`: the config *and* the runtime-created windows |
| Cross-platform switch | App menu still needs a separate Windows gate |

## 7. Complete removal, option B: keep `WS_THICKFRAME`, override `WM_NCCALCSIZE`

This is the “have both” route: keep the thick frame for native resize, snap,
and shadow, but tell Windows that the entire window is client area. The webview
then starts at the window’s top edge, while Windows still treats the edges as
resize handles. You must restore the resize hit-testing that the non-client
area used to provide.

This is the technique used by many custom-titlebar Win32 apps and by
`tauri-plugin-decorum`-style plugins. It is more code than the tint, and it is
**not what the repo uses**: option A above turned out to keep everything this
route was invented to preserve, so option B's only remaining benefit is the last
2 px — at the cost of overriding a client rect that tao also uses for sizing
(every re-created window would drift by the difference; see
[windows-window-frame.md §10](windows-window-frame.md#10-why-the-frame-is-2-px-and-not-1-px)).

### Sketch

This is a sketch, not the current implementation. It compiles in the same
style as [`win32.rs`](../src-tauri/src/win32.rs) (raw FFI, no `windows` crate).

```rust
use std::ffi::c_void;

type HWND = *mut c_void;
type LRESULT = isize;
type WPARAM = usize;
type LPARAM = isize;

const WM_NCCALCSIZE: u32 = 0x0083;
const WM_NCHITTEST: u32 = 0x0084;
const HTCLIENT: LRESULT = 1;
const HTLEFT: LRESULT = 10;
const HTRIGHT: LRESULT = 11;
const HTTOP: LRESULT = 12;
const HTTOPLEFT: LRESULT = 13;
const HTTOPRIGHT: LRESULT = 14;
const HTBOTTOM: LRESULT = 15;
const HTBOTTOMLEFT: LRESULT = 16;
const HTBOTTOMRIGHT: LRESULT = 17;

#[derive(Clone, Copy)]
#[repr(C)]
struct RECT { left: i32, top: i32, right: i32, bottom: i32 }

#[repr(C)]
struct NCCALCSIZE_PARAMS {
    rgrc: [RECT; 3],          // [0] proposed client, [1] window, [2] old client
    lppos: *mut c_void,       // WINDOWPOS*
}

#[link(name = "comctl32")]
unsafe extern "system" {
    fn SetWindowSubclass(
        hwnd: HWND,
        proc: Option<unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM, usize, usize) -> LRESULT>,
        id: usize,
        data: usize,
    ) -> i32;
    fn DefSubclassProc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT;
}

#[link(name = "user32")]
unsafe extern "system" {
    fn GetWindowRect(hwnd: HWND, rect: *mut RECT) -> i32;
    fn IsZoomed(hwnd: HWND) -> i32;
}

const SUBCLASS_ID: usize = 0x5749_4E43; // "WINC"

unsafe extern "system" fn chrome_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    match msg {
        WM_NCCALCSIZE if wparam != 0 => {
            let params = lparam as *mut NCCALCSIZE_PARAMS;
            if !params.is_null() {
                if IsZoomed(hwnd) == 0 {
                    // Client area == window rect: no non-client strip at all.
                    (*params).rgrc[0] = (*params).rgrc[1];
                }
                // When maximized, leave the default client rect: the frame is
                // already off-screen, and this avoids a screen-edge gap.
            }
            0
        }
        WM_NCHITTEST => {
            let hit = DefSubclassProc(hwnd, msg, wparam, lparam);
            if hit == HTCLIENT && IsZoomed(hwnd) == 0 {
                // lParam is screen coordinates, packed as two signed 16-bit values.
                let x = (lparam as i32 & 0xFFFF) as i16 as i32;
                let y = ((lparam >> 16) & 0xFFFF) as i16 as i32;
                let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                GetWindowRect(hwnd, &mut rect);
                let border = 7; // scale this by DPI, see below
                let left = x < rect.left + border;
                let right = x >= rect.right - border;
                let top = y < rect.top + border;
                let bottom = y >= rect.bottom - border;
                if top && left { return HTTOPLEFT; }
                if top && right { return HTTOPRIGHT; }
                if bottom && left { return HTBOTTOMLEFT; }
                if bottom && right { return HTBOTTOMRIGHT; }
                if left { return HTLEFT; }
                if right { return HTRIGHT; }
                if top { return HTTOP; }
                if bottom { return HTBOTTOM; }
            }
            hit
        }
        _ => DefSubclassProc(hwnd, msg, wparam, lparam),
    }
}

pub fn install_borderless_resize(hwnd: HWND) {
    unsafe {
        SetWindowSubclass(hwnd, Some(chrome_proc), SUBCLASS_ID, 0);
    }
}
```

### Details that will bite

- **Idempotence.** `SetWindowSubclass` with the same ID on the same HWND
  fails; treat the failure as “already installed” or remove the previous
  subclass first. The app’s page-load hook runs more than once for reloads.
- **Main thread.** Win32 window-proc calls must run on the UI thread. Tauri’s
  `setup` and `on_page_load` are the right places; if you call from an async
  task, wrap it in `app.run_on_main_thread`.
- **`SWP_FRAMECHANGED`.** After installing the subclass or changing style,
  call `SetWindowPos(hwnd, null, 0,0,0,0,
  SWP_NOMOVE|SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE|SWP_FRAMECHANGED)` so
  Windows recomputes the non-client metrics.
- **Maximized windows.** A maximized Win32 window extends slightly beyond the
  monitor. Setting the client rect to the raw window rect can clip content or
  leave a screen-edge gap. Either skip the override when `IsZoomed` is true
  (as above) or set `rgrc[0]` to the monitor work area from
  `MonitorFromWindow` + `GetMonitorInfoW`.
- **DPI.** The 7 px here is device pixels for the current DPI. Use
  `GetDpiForWindow` and
  `GetSystemMetricsForDpi(SM_CXSIZEFRAME, dpi) +
  GetSystemMetricsForDpi(SM_CXPADDEDBORDER, dpi)` for the hit-test band.
- **DWM border and rounding.** `WM_NCCALCSIZE` changes the client inset; it does
  not remove DWM’s 1 px border or its rounded corners. With the client area at
  the top edge, the dark title strip is clipped at the rounded corners; that
  usually looks right. If a light border or corner fringe remains, set
  `DWMWA_BORDER_COLOR` to the title colour or `DWMWA_COLOR_NONE`, and set
  `DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_DONOTROUND` if square corners are
  wanted.
- **Top-edge drag vs resize.** Once the top 7 px is client area, the React
  drag region will start a window **move** there unless `WM_NCHITTEST` returns
  `HTTOP`. The hit-test above makes the top edge resize, which is the usual
  borderless-window behaviour; the rest of the strip still drags.
- **Child webview.** The webview is a child HWND; it does not need its own
  NCCALCSIZE. The top-level window’s client rect is what gives it the extra
  7 px.
- **Menu.** This does not remove an `HMENU`. Combine with the menu gate or
  `Window::hide_menu`/`remove_menu`.

### Trade-offs

| Keeps | Costs |
| --- | --- |
| Native resize, snap, shadow | ~80–150 lines of unsafe Win32 |
| Webview starts at the top edge | Per-DPI hit-testing |
| No visual frame at all | Maximized/multi-monitor edge cases |
| No `decorations:false` side effects | Needs testing on every Windows version you support |

## 8. Menu-specific options

The native menu is independent of the frame. On Windows, Tauri’s app-wide menu
is assigned to all windows that do not have an explicit menu, including
windows created later. This app installs it from the webview on mount and on
focus, so removing it once is not enough; the install path itself must be
gated.

### Option 1: do not install it on Windows (current)

```ts
// src/appMenu.ts
if (PLATFORM !== "macos") return;
```

This is the simplest and what the repository does. Every accelerator that was
provided by the menu needs another handler:

- Open, Find, Find Next/Previous, undo/redo: already in `App.tsx` /
  `useHistoryShortcuts`.
- New Window: added as `Ctrl/Cmd+N`.
- Cut/copy/paste/select-all: WebView2 handles them.
- Close: `Alt+F4` on Windows (the predefined `CloseWindow` accelerator is
  `Alt+F4` on non-macOS).
- About/Hide/Quit: OS-level or not applicable on Windows.

### Option 2: install it but hide the bar

Tauri has a Rust-only `Window::hide_menu()`; the JS window API does not expose
it. It calls `SetMenu(hwnd, NULL)` + `DrawMenuBar`, so the menu bar disappears
without destroying the menu object. Tauri’s event loop still has the menu’s
`HACCEL` and calls `TranslateAcceleratorW`, so menu accelerators *may* keep
working, but this must be tested on your Tauri version before relying on it.

```rust
#[tauri::command]
fn hide_window_menu(window: tauri::Window) -> Result<(), String> {
    window.hide_menu().map_err(|error| error.to_string())
}
```

Add the command to the invoke handler, a capability for it, and call it after
`setAsAppMenu` resolves. Because the menu is app-wide, call it for every
window, including notes/reference windows, or use
`AppHandle::remove_menu()` if no menu is wanted at all.

### Option 3: remove the menu entirely

`Window::remove_menu()` (or `AppHandle::remove_menu()`) detaches and drops the
menu. Accelerators are gone. This is appropriate only if the app supplies all
shortcuts elsewhere. The raw Win32 equivalent is `SetMenu(hwnd, null)` plus
`DrawMenuBar(hwnd)`; that detaches the `HMENU` without destroying it, but it
does not update Tauri’s bookkeeping, so prefer the Tauri API.

### macOS is different

On macOS the same `Menu.setAsAppMenu()` is the **system menu bar**, outside the
window. Do not gate it off there. The code keeps the entire menu construction
for macOS and only skips it on Windows.

## 9. Related Tauri details

- **`titleBarStyle` values** are `Visible`, `Transparent`, `Overlay`;
  `hiddenTitle` is macOS-only. On Windows, Tauri ignores both.
- **`decorations`** is a per-window setting. A runtime
  `set_decorations(false)` affects the native frame but does not remove the
  app menu.
- **Window creation.** The main window comes from `tauri.conf.json`; notes,
  reference viewers, and “Open in New Window” copies are created with
  `WebviewWindow`. Those new windows receive the app-wide menu automatically on
  Windows. That is why the menu gate is at the source, not a one-time removal.
- **`hwnd()`.** `webview.window().hwnd()` gives the top-level `HWND`. The
  existing code uses it in `setup` for the main window and in `on_page_load`
  for every window.
- **Drag regions.** `data-tauri-drag-region="deep"` starts a drag anywhere in
  the subtree that is not a clickable element. It requires
  `core:window:allow-start-dragging` and
  `core:window:allow-internal-toggle-maximize`.
- **Custom window buttons** need `core:window:allow-minimize`,
  `core:window:allow-toggle-maximize`,
  `core:window:allow-is-maximized`, and `core:window:allow-close`.
- **Custom resize handles** need
  `core:window:allow-start-resize-dragging`.
- **Notifications/logging.** Window-proc code must not panic across FFI; keep
  the subclass body total and return `DefSubclassProc` for everything not
  handled.

## 10. What “completely removed” should mean

Use these definitions when deciding whether the job is done:

| Goal | Definition | Recipe |
| --- | --- | --- |
| Visually seamless (current) | No light pixels above the React title strip; native frame still exists but matches it | Strip caption + no Windows menu + DWM tint |
| Physically borderless, native behaviour kept | `ClientToScreen(0,0).y == GetWindowRect().top` and no menu, while resize/snap/shadow still work | `WM_NCCALCSIZE` + `WM_NCHITTEST` (Option B) |
| Physically borderless, simplest | Entire window is client area; no native frame at all | `decorations: false` + custom resize/drag (Option A) |
| Menu gone, frame kept | No `HMENU`, native resize/snap/shadow remain | Current menu gate + caption strip + tint |

The current repo is the first row. It is **not** the second or third row. That
is deliberate: the second and third rows require giving up or rebuilding native
window behaviour.

## 11. Test matrix

Anything that touches the non-client area needs to be checked on each of these:

- **Windows versions:** Windows 10 and Windows 11 (DWM attributes are Windows
  11 only; `DWMWA_WINDOW_CORNER_PREFERENCE` and `DWMWA_CAPTION_COLOR` are not
  available on Windows 10).
- **DPI:** 100%, 125%, 150%, 200%; per-monitor DPI changes when moving between
  screens.
- **Window states:** restored, maximized, minimized, restored from maximize,
  snapped left/right.
- **Edges:** all four edges and four corners resize; top edge is the tricky one
  after `WM_NCCALCSIZE`.
- **Focus:** active vs inactive; DWM caption/border colours can change with
  focus and theme.
- **Theme:** light, dark, custom accent, high contrast.
- **Windows:** main, `app-*` copies, `notes`, `notes-app-*`,
  `viewer-note-*`, `viewer-doc-*`; the app menu is app-wide and the caption
  strip runs on every page load.
- **DPI/scale changes while running:** drag the window between monitors and
  re-check the top band and resize cursors.
- **Accessibility:** keyboard-only resize, Alt+Space system menu, Alt+F4, focus
  rings, screen-reader window title.
- **Menu:** every accelerator still fires from every window, or is explicitly
  replaced.

## 12. Pitfalls checklist

- `WS_CAPTION` is `WS_BORDER | WS_DLGFRAME`, not `WS_THICKFRAME`.
- Clearing a style bit is not enough; call `SetWindowPos(...,
  SWP_FRAMECHANGED)` so Windows recomputes non-client metrics.
- The menu is a separate `HMENU`; style changes do not touch it.
- `DWMWA_BORDER_COLOR` only colours the border (1 px); it does not remove the
  caption strip.
- `DWMWA_CAPTION_COLOR` is the attribute that colours the top strip.
- DWM colour attributes are Windows 11; on Windows 10 the calls fail and the
  system colour remains.
- `DWMWA_COLOR_NONE` is not a universal “remove all chrome”; its meaning
  depends on the attribute.
- `decorations:false` removes the resize frame, shadow, and snapping; plan for
  resize handles.
- `WM_NCCALCSIZE` consumes the proposed client rect; do not also call
  `DefSubclassProc` for the handled case.
- `WM_NCHITTEST` coordinates are screen coordinates and packed signed 16-bit
  values; use `GET_X_LPARAM`/`GET_Y_LPARAM` semantics.
- Maximized windows need special handling; the window rect is larger than the
  monitor.
- The titlebar’s hover colour is not the same as its rest colour; a DWM tint
  matches the rest colour and leaves a subtle 6 px cap on hover.
- CSS cannot paint the non-client area; do not try to fix native chrome with
  `border-top` or `box-shadow`.
- Keep macOS’s `titleBarStyle: "Overlay"` / `hiddenTitle` and its global menu;
  gate Windows-only changes by platform.

## 13. Appendix A: diagnostics

### Measure the non-client frame

```python
import ctypes, ctypes.wintypes as w

u = ctypes.windll.user32
hwnd = w.HWND(<hwnd>)

class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long)]

class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

wr = RECT(); u.GetWindowRect(hwnd, ctypes.byref(wr))
origin = POINT(0, 0); u.ClientToScreen(hwnd, ctypes.byref(origin))
cr = RECT(); u.GetClientRect(hwnd, ctypes.byref(cr))

print("non-client top", origin.y - wr.top)
print("non-client left", origin.x - wr.left)
print("non-client right", wr.right - (origin.x + cr.right))
print("non-client bottom", wr.bottom - (origin.y + cr.bottom))
```

### Read the window style

```python
GWL_STYLE = -16
style = u.GetWindowLongW(hwnd, GWL_STYLE) & 0xFFFFFFFF
WS_CAPTION = 0x00C00000
WS_THICKFRAME = 0x00040000
print(hex(style), "caption", bool(style & WS_CAPTION),
      "thick", bool(style & WS_THICKFRAME))
```

### Test the DWM colours

```python
dwm = ctypes.windll.dwmapi
red = ctypes.c_uint(0x000000FF)  # COLORREF: 0x00BBGGRR
dwm.DwmSetWindowAttribute(hwnd, 35, ctypes.byref(red), 4)  # DWMWA_CAPTION_COLOR
# If the top strip turns red, it is the DWM caption colour.
```

### Test whether the thick frame owns the strip

Remove `WS_THICKFRAME`, force a frame change, and observe:

```python
style = u.GetWindowLongW(hwnd, GWL_STYLE)
u.SetWindowLongW(hwnd, GWL_STYLE, style & ~0x00040000)
u.SetWindowPos(hwnd, 0, 0, 0, 0, 0,
               0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020)
# Restore the style immediately afterwards; resize is gone while it is off.
```

If the strip disappears, the strip is part of the thick frame, not the menu or
CSS.

## 14. Appendix B: relevant constants

| Name | Value | Meaning |
| --- | --- | --- |
| `GWL_STYLE` | `-16` | `GetWindowLongW` index for window style |
| `WS_CAPTION` | `0x00C00000` | `WS_BORDER \| WS_DLGFRAME` |
| `WS_THICKFRAME` | `0x00040000` | Resizable frame / native resize+snap |
| `WS_SYSMENU` | `0x00080000` | System menu (Alt+Space) |
| `SWP_FRAMECHANGED` | `0x0020` | Recompute non-client metrics |
| `WM_NCCALCSIZE` | `0x0083` | Non-client size calculation |
| `WM_NCHITTEST` | `0x0084` | Non-client hit testing |
| `HTCLIENT` | `1` | Client area |
| `HTLEFT` … `HTBOTTOMRIGHT` | `10` … `17` | Resize borders/corners |
| `DWMWA_BORDER_COLOR` | `34` | 1 px DWM border colour |
| `DWMWA_CAPTION_COLOR` | `35` | DWM caption area colour |
| `DWMWA_WINDOW_CORNER_PREFERENCE` | `33` | Windows 11 corner rounding |
| `DWMWA_COLOR_DEFAULT` | `0xFFFFFFFF` | Use system default |
| `DWMWA_COLOR_NONE` | `0xFFFFFFFE` | No border (attribute-dependent) |

## 15. References

- Microsoft, [Window Styles](https://learn.microsoft.com/en-us/windows/win32/winmsg/window-styles)
  (`WS_CAPTION`, `WS_THICKFRAME`).
- Microsoft, [`WM_NCCALCSIZE`](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-nccalcsize)
  and [`NCCALCSIZE_PARAMS`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-nccalcsize_params).
- Microsoft, [`WM_NCHITTEST`](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-nchittest).
- Microsoft, [Custom Window Frame Using DWM](https://learn.microsoft.com/en-us/windows/win32/dwm/customframe).
- Microsoft, [`DwmSetWindowAttribute`](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmsetwindowattribute)
  and [`DWMWINDOWATTRIBUTE`](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute).
- Tauri v2, [Window configuration](https://v2.tauri.app/reference/config/#windowconfig).
- Tauri v2, [Window menu](https://v2.tauri.app/learn/window-menu/).
- Tauri v2, [`Window`](https://docs.rs/tauri/latest/tauri/window/struct.Window.html)
  (`hide_menu`, `remove_menu`, `set_decorations`, `start_resize_dragging`).
- Tauri v2, [Capabilities](https://v2.tauri.app/security/capabilities/).
