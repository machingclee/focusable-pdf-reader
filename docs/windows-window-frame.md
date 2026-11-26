# The window frame: making the app occupy the whole window

This is the as-built record of the change that made the app's content reach the
window's own edges on Windows — the strip starts at the top of the window, the
close button sits in the corner Windows rounds, and there is no band of
"almost the app" above either of them.

It is written for someone who has to touch this again: it says what the symptom
looked like, why the obvious explanations were wrong, what the final
implementation is and why each piece is there, and how to measure it. The
exploratory history — the native menu bar, and the two removal strategies as
*proposals* — is in [windows-app-bar.md](windows-app-bar.md); its §6 recipe was
implemented here, with corrections (see [§7](#7-what-did-not-have-to-be-rebuilt)).

## The problem, stated plainly

**Symptom:** a thin white/light-blue stroke along the window's edge, most
obvious at the top-right corner. In the reported build it was a one-pixel line;
measured at full scale it was the light-blue `#B9D1EA` ring of the native frame.

**Root cause:** the ring between the webview and DWM's border was never painted,
and the window was still in its **8 px frame** state because `WS_CAPTION` had not
actually been cleared when the frame was last computed. The earlier `setup` /
`on_page_load` hooks either ran before tao's final style pass or were overwritten
by it; maximize/restore could also put the caption bit back. With the caption
set, the ring is 8 px wide instead of the 2 px the paint code was written for,
and the unpainted part showed the compositor's light blue.

**Not the cause:** CSS, React layout, the app's title strip, the DWM *border
colour*, or the native app menu. Clearing `WS_CAPTION` on the running window
made the stroke disappear immediately, which isolated it to the non-client frame.

**Evidence:**

```text
window rect     1216 × 869
client          1200 × 860 at (455, 179)   → non-client 8 / 1 / 8 / 8
style           0x14cf0000                 → WS_CAPTION still set
measured pixel  (185, 209, 234) = #B9D1EA  → the unpainted ring
```

**Fix:** apply the frame work late and repeatably —
`RunEvent::Ready`, `WindowEvent::Focused(true)`, and `WindowEvent::Resized(_)` —
paint the ring directly as well as on `WM_NCPAINT`, and force
`SWP_FRAMECHANGED` only when the subclass is newly installed or `WS_CAPTION`
was newly cleared. The expected end state is `WS_CAPTION == 0` and a
**2 / 1 / 2 / 2** client inset. The detailed diagnosis is in §6.6.

## 1. The symptom

On Windows the app had a band along the top of the window that was painted the
same colour as the title strip — so it looked like nothing was wrong until the
strip changed colour. Hovering the close button was the tell:

- the red hover fill was **square at the top-right**, with a strip of dark
  between it and the window's edge;
- the strip lifted to `--bg-elev-hover` on hover while the band above it stayed
  `--bg-elev`, exposing a seam that is invisible at rest;
- at the sides and bottom there was a 1 px line that came and went, and at the
  top there was **7 px**.

Nothing in CSS was wrong. `html, body, #root` were already `height: 100%`, and
`App.tsx`'s root was already `display: flex; height: 100%`. An app can only fill
its **client area**, and the client area did not start at the window's top edge.
That is the whole problem, and it is why no amount of layout could fix it.

## 2. TL;DR of the fix

Four things, in this order:

1. **Run the window undecorated** — `decorations: false` + `shadow: true`,
   declared for Windows in
   [`src-tauri/tauri.windows.conf.json`](../src-tauri/tauri.windows.conf.json)
   and passed by [`windowBridge.ts`](../src/windowBridge.ts#L340-L342) for the
   windows created at runtime. On this Tauri this does **not** cost the resize
   frame, the drop shadow or snapping (see §7).
2. **Keep `strip_caption`** ([`win32.rs`](../src-tauri/src/win32.rs#L222-L244)),
   even though the window is already undecorated. It is what makes the residual
   frame **2 px instead of 8 px**: clearing `WS_CAPTION` is what makes DWM give
   the window an *invisible* border, and tao's fixed client inset then lands
   2 px inside the visible edge rather than 8 px.
3. **Finish the frame** ([`win32.rs`](../src-tauri/src/win32.rs#L173-L268)):
   paint the 1 px ring between the webview and DWM's border on `WM_NCPAINT`
   (nothing else paints it, and it showed as a white hairline), and point
   `DWMWA_BORDER_COLOR` at `--bg-elev`, followed by `SWP_FRAMECHANGED` so DWM
   rebuilds the frame with that colour.
4. **Apply it late enough.** `setup` and `on_page_load` can run before tao's
   last style pass. A packaged build was measured with `WS_CAPTION` still set
   after both, leaving the 8 px frame and its unpainted ring. `apply` therefore
   also runs from `RunEvent::Ready`, `WindowEvent::Focused(true)` and
   `WindowEvent::Resized(_)` — tao can re-add the caption while maximizing or
   restoring — and it paints the ring directly in addition to handling
   `WM_NCPAINT` (§6.6).

## 3. Why CSS could never fix it

Windows divides a top-level window into two regions:

| Region | Owner | Can CSS reach it? |
| --- | --- | --- |
| **Client area** — where the webview lives | the app | yes |
| **Non-client area** — caption, borders, resize frame | DWM / `DefWindowProc` | **no** |

The app's `#root` is laid out inside the client rectangle. If the client
rectangle starts 7 px below the window's top edge, the app starts 7 px below the
top edge. `position: fixed`, negative margins, `inset: 0`, `100vh` — all of it is
measured against the client area, which is the same 7 px late.

That is also why the previous implementation could only make the band
*invisible*: [`tint_frame`](../src-tauri/src/win32.rs#L87-L94) painted the DWM
caption colour `#323237`, which happens to equal `--bg-elev` — the strip's
colour **at rest**. It was a colour match, not a removal, and it broke the
moment the strip changed colour (hover) or had to be another colour (a page, the
notes column, a card).

## 4. Anatomy: three rectangles and one number that matters

Three rectangles describe a Windows 11 window, and they are all different:

| Rect | How to read it | What it is |
| --- | --- | --- |
| **Window rect** | `GetWindowRect` | what the window owns, including the invisible resize border |
| **Visible frame** | `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS = 9)` | what the user sees, including the 1 px DWM border, excluding the shadow |
| **Client rect** | `GetClientRect` + `ClientToScreen` | where the webview is, and therefore where the app is |

"Make the app occupy the whole window" means **client rect == visible frame**.
The window rect is never a target: the strip of it outside the visible frame is
the resize border, and content there is clipped by DWM.

### Before and after, measured on this machine at 100% scaling

| | window rect | visible frame | client | client inside the visible frame | residual frame |
| --- | --- | --- | --- | --- | --- |
| **Before** (decorated, caption stripped) | 1216×899 | 1204×893 | 1200×860 at `(137,137)` | L/R/B **1 px**, T **7 px** | 7 px band on top, painted `#323237` |
| **After** (as built) | 1216×869 | 1204×863 | 1200×860 at `(138,131)` | L/R/B **2 px**, T **1 px** | uniform `#323237`, follows the corner radius |

The 30 px of height between the two window rects is the caption height an
undecorated window no longer asks for; the width is unchanged, because the
horizontal frame is the same 8 px either way.

Maximized, measured the same way:

```
window rect    (-7,-7) - (3447,1447)        inflated beyond the monitor, as Windows does
visible frame  (0,0)   - (3440,1440)        the monitor
client         3440×1392 at (0,0)           exactly the monitor's work area
```

i.e. maximized the app fills the work area with no frame at all, which is what a
native maximized window does; the corners are square there and the close button
is flush against the screen's corner.

## 5. Part 1 — run the window undecorated

The native caption has to be gone on Windows, and it cannot be gone on macOS
(there it *is* the traffic lights). Tauri's window config has no per-platform
switch, so the change is declared per platform.

[`src-tauri/tauri.windows.conf.json`](../src-tauri/tauri.windows.conf.json):

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "PDF Focus Viewer",
        "width": 1200,
        "height": 860,
        "minWidth": 720,
        "minHeight": 480,
        "allowLinkPreview": false,
        "decorations": false,
        "shadow": true
      }
    ]
  }
}
```

Two things about this file:

- **It is a whole window object, not a patch.** Tauri merges a platform config
  over the base one with JSON Merge Patch (RFC 7396), and a patch *replaces*
  arrays — it does not merge array elements. Every field of the main window that
  `tauri.conf.json` sets must therefore be repeated here. A change to the main
  window belongs in both files; the shared values are the four sizes, the title,
  the label and `allowLinkPreview`.
- **It is read by the build, not only by the CLI.** `tauri-build` emits
  `cargo:rerun-if-changed` for each config path it read, so a *new* platform
  file is not in the watched list of an existing build. Adding it needs a
  rebuild of the build script (touch `build.rs`, or `cargo clean`), otherwise
  the embedded config keeps the old window list and the flag silently does
  nothing.

macOS is untouched by this file: it keeps its decorations and gets its overlay
title bar from `titleBarStyle`/`hiddenTitle` in the shared `tauri.conf.json`.

### The windows created at runtime

The notes column, a note reference and "File → Open in New Window" are not in
the config at all — they are created by `new WebviewWindow(label, options)` in
[`windowBridge.ts`](../src/windowBridge.ts). Rather than repeat the flags at
each call site (and rely on nobody forgetting), the chrome is merged in one
place:

```ts
const WINDOW_CHROME: NotesWindowOptions = IS_WINDOWS
  ? { decorations: false, shadow: true }
  : {};

const win = new WebviewWindow(label, { ...options, ...WINDOW_CHROME });
```

The frame's *paint* is applied separately, to every window, from
`on_page_load` ([`lib.rs`](../src-tauri/src/lib.rs#L314-L316)): that hook is the
one place the app sees windows it did not create.

## 6. Part 2 — why `strip_caption` stays

This is the least obvious piece and the one most likely to be deleted by
mistake, because it looks redundant: the window is already undecorated, so why
clear `WS_CAPTION` as well?

Because `WS_CAPTION` is what decides whether DWM gives the window an **invisible
border**, and that border is what tao's client inset is measured against.

`tao` 0.35 answers `WM_NCCALCSIZE` itself for an undecorated window
(`platform_impl/windows/event_loop.rs`, the `WM_NCCALCSIZE` arm): it returns 0
— "the whole window is client area" — after insetting the proposed rect by
`calculate_insets_for_dpi` (`util.rs`), which is

```
left = right = bottom = SM_CXSIZEFRAME + SM_CXPADDEDBORDER   // 8 px at 100%
top                    = round(dpi / 96)                     // 1 px at 100%
```

Those numbers are what tao *also* adds when it sizes the window, so its model is
self-consistent: `innerSize()` round-trips, and the webview is exactly the
requested 1200×860.

Now the interaction with the caption bit:

| `WS_CAPTION` | window rect vs visible frame | tao's 8 px inset lands |
| --- | --- | --- |
| **present** | identical (no invisible border) | **8 px** inside the visible edge → an 8 px band of "not the app" |
| **cleared** | visible frame is 6 px inside on L/R/B, 0 px at the top | **2 px** inside the visible edge → a 2 px frame |

Measured, with `decorations: false` in both cases:

```
WS_CAPTION present:  window 1216×869, visible 1216×869, client 1200×860 → inset 8/1/8/8
WS_CAPTION cleared:  window 1216×869, visible 1204×863, client 1200×860 → inset 2/1/2/2
```

So `strip_caption` is not a leftover from the old approach — it is the step that
turns an 8 px frame into a 2 px one, by giving DWM an invisible border for tao's
inset to hide in.

### What the 2 px actually is

- the **outer 1 px** is DWM's border, drawn over whatever the window paints
  there. It is tinted in §6.3 so it reads as the app's frame.
- the **inner 1 px** is the part of tao's inset that is still inside the visible
  frame. Nothing paints it (§6.2).

The top is 1 px, not 2, because tao's top inset is exactly the 1 px DWM border
there — which is also why the top edge looked "correct" in the old build while
the sides did not.

## 6.1 The `decorations: false` flag does not remove the frame — it moves it

Worth stating plainly, because it is where the old doc's expectations go wrong:
`decorations: false` does not make the window frameless. Tauri's `decorations`
maps to tao's `MARKER_DECORATIONS`; tao keeps `WS_THICKFRAME` in the style and
only overrides how the client area is computed. The frame is still there, it is
just no longer reserved *for a caption*. (See §7 for what that buys.)

## 6.2 The 1 px ring nothing painted

With the client area 2 px inside the visible frame, the ring between the webview
and DWM's border belongs to the window's own surface — and the window class has
**no background brush** (`tao` passes `HBRUSH::default()`). `DefWindowProc`'s
`WM_NCPAINT` paints nothing there for a caption-less window, and setting the
class brush (`GCLP_HBRBACKGROUND`) does not help either.

The result was a **1 px white/light-blue line down the sides and along the
bottom** — uninitialised composition, occasionally white, occasionally a pale
blue — which is not subtle on a dark app:

```
row 20  left : x0 #323237  x1 (153,180,209)  x2 #3a3a40(cont)  ...
row 20  right: ... x1201 #e81123(red) x1202 (185,209,234) x1203 #323237
```

The fix is a window subclass that paints the ring itself
([`win32.rs`](../src-tauri/src/win32.rs#L150-L200)):

```rust
if msg == WM_NCPAINT {
    paint_frame(hwnd);   // GetWindowDC + CreateSolidBrush(#323237) + FillRect + DeleteObject + ReleaseDC
    return 0;
}
```

Filling the **whole** window rectangle is deliberate and safe: the client area
belongs to the webview's child window, which paints itself over the parent's
pixels, so only the ring between them keeps the fill. Measuring the ring and
filling exactly it would be the same pixels for more code.

The subclass is installed with `SetWindowSubclass` and forwards everything else
down the chain with `DefSubclassProc`, which is where tao's own subclass sits —
ours is newer, so it runs first and the default handling still happens
underneath.

## 6.3 The border colour, and why it needs `SWP_FRAMECHANGED`

DWM's 1 px border is the system's light grey on a dark app. Setting
`DWMWA_BORDER_COLOR` alone is not enough: DWM reads that attribute when it
builds a frame, and a window that has already been created never builds another
one. The measured behaviour was that the border stayed grey until the frame was
forced:

```rust
DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, &FRAME_COLORREF, 4);
SetWindowPos(hwnd, null, 0,0,0,0,
    SWP_NOMOVE|SWP_NOSIZE|SWP_NOZORDER|SWP_NOACTIVATE|SWP_FRAMECHANGED);
```

`FRAME_COLORREF = 0x0037_3232` is `COLORREF` (`0x00BBGGRR`) for `#323237`, i.e.
`--bg-elev` in [`App.css`](../src/App.css#L13-L15). **Keep the two in step**: the
frame and the ring are the same surface as the strip inside them.

`SWP_FRAMECHANGED` is also what makes the stripped style bits take effect on
first run, which is why `strip_caption` does not need a second one.

## 6.4 Applying it: five calls, not two

[`lib.rs`](../src-tauri/src/lib.rs#L383-L470) calls `apply_window_chrome` /
`apply_window_chrome_for_window` in five places:

- **`setup`**, for `main`, before the first paint — otherwise startup shows the
  system's grey border around a dark window for a frame;
- **`on_page_load`**, for every window including the ones `setup` cannot see
  (notes, reference viewers, a document opened in a window of its own, a second
  app window);
- **`RunEvent::Ready`**, for every window that exists when the event loop is up.
  This is the first point that is reliably after tao's final style pass;
- **`WindowEvent::Focused(true)`**, for every window that is focused. This is the
  repair path: if the style still has `WS_CAPTION`, this clears it and repaints
  the frame before the user can look at it;
- **`WindowEvent::Resized(_)`**, for every resize, maximize and restore. tao can
  re-add the caption bit while changing window state, which put the line back
  after a successful startup. `apply` returns immediately when the subclass is
  already in place and the caption is already clear, so the common resize step
  costs two cheap reads and no paint.

`apply` is idempotent: `SetWindowSubclass` with the same id replaces the entry in
the chain, `strip_caption` returns early when `WS_CAPTION` is already clear, and
the frame change is only forced when the subclass was newly installed or the
caption was newly cleared. Re-applying on focus does **not** force a frame
change on a finished window; it only repaints the ring.

## 6.5 What is left of the frame, and what it looks like

2 px on the left, right and bottom; 1 px at the top; all of it `#323237`. It
follows the DWM corner radius (8 px at 100%), because it is painted inside the
window's surface and DWM clips that surface:

![close button on hover](images/window-frame-corner.png)

The red hover fill is clipped by the corner arc — that is the acceptance test in
§8. On a maximized window the corners are square and the frame collapses to
nothing at the sides (client == work area, §4).

## 6.6 The packaged-build race: why the light line came back

A release build was measured with the light line still there even though all of
§6.1–§6.5 was implemented. The probe said:

```text
window rect     1216 × 869
client          1200 × 860 at (455, 179)   → non-client 8 / 1 / 8 / 8
style           0x14cf0000                 → WS_CAPTION still set
visible frame   == window rect
```

That is the **pre-strip** row of §6: an 8 px frame, not the 2 px one. The light
line was the **unpainted ring** over an 8 px frame, not the 2 px ring the
`WM_NCPAINT` paint was written for.

Two lifecycle details caused it:

1. `setup` and `on_page_load` ran **before tao's final style pass**. `tao` builds
   the undecorated window, then applies its own non-client calculation; a
   `strip_caption` that runs too early is either a no-op (the bit is not set yet)
   or is overwritten when the final style is written.
2. `WM_NCPAINT` alone is not enough on a window that never receives it (or
   receives it before the subclass is in the chain). The ring stayed at whatever
   the compositor had — a light blue/white line. The reported pixel was
   `(185, 209, 234)` (`#B9D1EA`), the same colour the §6.2 probe had recorded
   before the ring was painted.

The fix is to make the apply **late and repeatable**, not to change the drawing:

- `lib.rs` calls `apply_window_chrome` again from `RunEvent::Ready` (after the
  event loop and the windows exist), from `WindowEvent::Focused(true)` (the first
  event that is guaranteed to be after the style pass), and from
  `WindowEvent::Resized(_)` (maximize/restore can re-add the caption bit). The
  focus/resize calls are also the repair path if another Windows version re-adds
  the bit later.
- `apply` calls `paint_frame` **directly** after the frame change, not only from
  `WM_NCPAINT`. `WM_NCPAINT` remains the normal path; the direct call covers the
  first apply and the case where Windows skips the paint.
- `strip_caption` now returns whether it changed the style, so `apply` forces
  `SWP_FRAMECHANGED` exactly once on the run that clears the caption, and not on
  every subsequent focus.
- `SetWindowSubclass` is installed before the frame change, so the
  `WM_NCPAINT` it triggers reaches `frame_proc`.

Acceptance for this specific failure: after launch and after clicking the window,
`GetWindowLongW(hwnd, GWL_STYLE) & WS_CAPTION` must be `0`, and the frame probe
must report **2 / 1 / 2 / 2** non-client pixels, not 8 / 1 / 8 / 8. If it reports
8 / 1 / 8 / 8, `apply` did not run late enough — check the `RunEvent::Ready` and
focus hooks before touching the paint code.

## 7. What did *not* have to be rebuilt

[windows-app-bar.md §6](windows-app-bar.md#6-complete-removal-option-a-decorations-false)
lists what `decorations: false` costs: native resize hit-testing, the drop
shadow, Windows snap — and therefore a set of eight CSS resize handles,
`startResizeDragging`, and an extra capability. **On this Tauri that list is out
of date**, and none of it was needed:

| Concern | Why it still works with `decorations: false` |
| --- | --- |
| Resize | `WS_THICKFRAME` stays in the style (tao keeps it and overrides `WM_NCCALCSIZE`), so the non-client ring tao leaves is still a resize border to `DefWindowProc`. tao additionally attaches a child hit-test window for undecorated windows (`tauri-runtime-wry`, `undecorated_resizing::attach_resize_handler`, called when `window.is_resizable() && !window.is_decorated()`), which owns the top edge. |
| Drop shadow | DWM draws it for a `WS_THICKFRAME` window; `shadow: true` is what tao needs for its insets and for that child window. |
| Snap / `Win`+arrows | Tied to the frame, not the caption; unchanged. |
| Maximize | tao's `WM_NCCALCSIZE` hands back the monitor's work area when the window is maximized (the `is_maximized` branch), so content never runs off-screen — measured in §4. |
| Drag | `data-tauri-drag-region="deep"` on the strip + `core:window:allow-start-dragging`, unchanged. |
| Window buttons | Already the app's own (`WindowControls`). |
| Rounded corners + 1 px border | DWM rounds framed windows on Windows 11; `DWMWA_BORDER_COLOR` tints the border (§6.3). |

The version this rests on: `tauri 2.11.5`, `tao 0.35.3`,
`tauri-runtime-wry 2.11.4`. Re-check this table before upgrading either.

## 8. Acceptance test

Hover the close button:

- **pass** — the red fill reaches the window's corner and its top-right corner
  is **rounded**, clipped by the window's own corner arc;
- **fail, the old way** — a dark band above the red, and a **square** red corner
  (the band is the DWM caption area, and the strip is 7 px short of the top);
- **fail, the missing-ring way** — a rounded red corner with a **light 1 px**
  outline inside it (the unpainted ring, §6.2).

Programmatically, from any shell (§9): `client.origin − visible.origin` should be
`(2,1)` and `client.size` should be `1200×860` for a default window. Also read
`GetWindowLongW(hwnd, GWL_STYLE) & WS_CAPTION`; it must be `0`. A `(8,1)` inset
means the caption bit was still set when the frame was last computed (§6.6).

## 9. How to measure any of this

The numbers in §4 come from this, in PowerShell. It is the only reliable way to
tell the three rectangles apart; `GetWindowRect` alone will mislead you.

```powershell
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class FrameProbe {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtrW(IntPtr h, int i);
  [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] public static extern int DwmRect(IntPtr h, int attr, out RECT r, int size);
  [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] public static extern int DwmInt(IntPtr h, int attr, out int v, int size);
}
"@
# $h = the HWND of the "Tauri Window" class
$wr = New-Object FrameProbe+RECT; [FrameProbe]::GetWindowRect($h, [ref]$wr)          | Out-Null
$eb = New-Object FrameProbe+RECT; [FrameProbe]::DwmRect($h, 9, [ref]$eb, 16)         | Out-Null  # DWMWA_EXTENDED_FRAME_BOUNDS
$cr = New-Object FrameProbe+RECT; [FrameProbe]::GetClientRect($h, [ref]$cr)          | Out-Null
$org = New-Object FrameProbe+POINT; [FrameProbe]::ClientToScreen($h, [ref]$org)      | Out-Null
$style = [int64][FrameProbe]::GetWindowLongPtrW($h, -16)
$corner = -1; [FrameProbe]::DwmInt($h, 33, [ref]$corner, 4) | Out-Null               # DWMWA_WINDOW_CORNER_PREFERENCE

"window   $($wr.Right-$wr.Left)x$($wr.Bottom-$wr.Top)"
"visible  $($eb.Right-$eb.Left)x$($eb.Bottom-$eb.Top)"
"client   $($cr.Right)x$($cr.Bottom) at $($org.X),$($org.Y)"
"inset vs visible  L=$($org.X-$eb.Left) T=$($org.Y-$eb.Top) R=$($eb.Right-$org.X-$cr.Right) B=$($eb.Bottom-$org.Y-$cr.Bottom)"
"CAPTION=$([bool]($style -band 0x00C00000)) SIZEBOX=$([bool]($style -band 0x00040000))"
"corner preference $corner   (0 = default, 2 = round)"
```

To check the paint rather than the geometry, screenshot the window's visible
rect and read the edge pixels: they should be `#323237` out to the 1 px DWM
border, with no white/light line anywhere. [windows-app-bar.md](windows-app-bar.md)
Appendix A has the Python/`ctypes` version of the same probe and the experiments
that identify which layer owns a strip (temporarily clearing `WS_THICKFRAME`,
setting `DWMWA_CAPTION_COLOR` to red, and so on).

## 10. Why the frame is 2 px and not 1 px

It can be made exactly 1 px, but not without breaking something else, and the
trade was made deliberately.

To get 1 px, the app would have to override `WM_NCCALCSIZE` itself and hand back
a client rect equal to the visible frame (option B in
[windows-app-bar.md](windows-app-bar.md#7-complete-removal-option-b-keep-ws_thickframe-override-wm_nccalcsize)),
undoing tao's 2 px excess. The cost is the sizing model: tao computes the outer
size as `inner + (8,1,8,8)`, so a client rect that is 12 px narrower than tao
believes makes `innerSize()` report 4 px more than requested, and every
`set_inner_size` (and every re-created window) drifts by that amount.

That drift is not theoretical here: the detached notes window persists
`outerPosition` + `innerSize` ([`notesWindowGeometry.ts`](../src/notesWindowGeometry.ts),
[`DetachedNotesApp.tsx`](../src/DetachedNotesApp.tsx#L202-L227)) and reopens with
them, so it would grow 4×3 logical px on every reopen. A 2 px frame that is
uniform, tinted and follows the corner is the better trade — it is also what a
native window's frame looks like.

If 1 px ever becomes a requirement, the honest fix is to correct the saved
geometry alongside it (persist the outer size, or subtract the known delta), not
to override `WM_NCCALCSIZE` on its own.

## 11. Files touched

| File | Role |
| --- | --- |
| [`src-tauri/tauri.windows.conf.json`](../src-tauri/tauri.windows.conf.json) | the main window, undecorated, Windows only |
| [`src-tauri/src/win32.rs`](../src-tauri/src/win32.rs) | the frame: `strip_caption`, `WM_NCPAINT` ring, border tint, subclass, idempotent `apply` |
| [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs) | applies it from `setup`, `on_page_load`, `RunEvent::Ready`, `WindowEvent::Focused(true)`, and `WindowEvent::Resized(_)` |
| [`src/windowBridge.ts`](../src/windowBridge.ts#L340-L348) | the same chrome for windows created at runtime |
| [`src/components/TitleBar.tsx`](../src/components/TitleBar.tsx), [`src/components/WindowControls.tsx`](../src/components/WindowControls.tsx), [`src/platform.ts`](../src/platform.ts) | documentation of what the strip is and why the platform matters |
| [`src/App.css`](../src/App.css#L189-L191) | no layout change was needed; the Windows strip's padding is not a gutter |

`src/App.css`, `App.tsx` and the rest of the layout were **not** part of the fix:
they were already correct (§1).

## 12. Checklist for the next time

- [ ] `decorations: false` is in **both** the platform config (for `main`) and
      `WINDOW_CHROME` (for runtime windows). A window created without it has the
      native caption and the whole problem returns for that window only.
- [ ] The platform config **repeats the whole window object** — arrays are
      replaced by the merge, not merged.
- [ ] After adding the platform file, the build script was re-run (the flag
      silently does nothing otherwise, see §5).
- [ ] `strip_caption` is still called — without it the frame is 8 px (§6).
- [ ] The `WM_NCPAINT` subclass is still installed — without it there is a light
      1 px hairline (§6.2).
- [ ] `FRAME_COLORREF` still equals `--bg-elev`, and the tint is followed by
      `SWP_FRAMECHANGED` (§6.3).
- [ ] All five calls still exist: `setup`, `on_page_load`, `RunEvent::Ready`,
      `WindowEvent::Focused(true)`, and `WindowEvent::Resized(_)` (§6.4, §6.6).
- [ ] On a release build, `GetWindowLongW(hwnd, GWL_STYLE) & WS_CAPTION == 0`
      after the window is focused; if not, the early hooks won the race again
      (§6.6).
- [ ] `apply` still calls `paint_frame` directly, not only from `WM_NCPAINT`.
- [ ] The acceptance test in §8 passes on a **clean** launch, and again after
      maximizing and restoring.
- [ ] macOS was not touched: it must keep its decorations (the traffic lights)
      and its `titleBarStyle: "Overlay"`.

## 13. References

- `tauri-utils` 2.9.3, `src/config.rs` — `shadow` documented as "undecorated
  windows get a 1 px border and, on Windows 11, rounded corners".
- `tao` 0.35.3, `src/platform_impl/windows/event_loop.rs` — the `WM_NCCALCSIZE`
  arm (return 0, the maximized → work-area branch, the shadow insets) and the
  `WM_NCHITTEST` arm (resize edges for undecorated windows).
- `tao` 0.35.3, `src/platform_impl/windows/util.rs` —
  `calculate_insets_for_dpi`, `get_frame_thickness`, `adjust_window_rect`.
- `tao` 0.35.3, `src/platform_impl/windows/window_state.rs` —
  `to_window_styles`; `WS_THICKFRAME` survives `decorations: false`.
- `tauri-runtime-wry` 2.11.4, `src/lib.rs` — `shadow()` mapping to
  `with_undecorated_shadow`, and the `attach_resize_handler` call for
  undecorated resizable windows; `src/undecorated_resizing.rs` for the child
  hit-test window.
- Microsoft, `DWMWA_EXTENDED_FRAME_BOUNDS`, `DWMWA_BORDER_COLOR`,
  `DWMWA_WINDOW_CORNER_PREFERENCE`; `WM_NCCALCSIZE`, `WM_NCPAINT`.
