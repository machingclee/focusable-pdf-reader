//! Windows window chrome: the app's strip is the window's top edge.
//!
//! macOS has never drawn a title bar for this app. `titleBarStyle: "Overlay"`
//! plus `hiddenTitle: true` in `tauri.conf.json` leaves the traffic lights
//! floating over the content, and the app's own strip
//! (`src/components/TitleBar.tsx`) is the only bar the window has. Both of those
//! settings are macOS-only, so on Windows the strip used to sit *under* the
//! standard caption: two bars, and the upper one is not the one the design asked
//! for.
//!
//! ## Where the caption goes
//!
//! `decorations: false`, declared for Windows in `tauri.windows.conf.json` (and
//! passed by `windowBridge.ts` for the windows the app opens later; the
//! platform file restates the main window because a JSON merge replaces the
//! `windows` array whole, so a change to that window belongs in *both* files).
//!
//! The worry this module was originally built around — that undecorated means no
//! resize frame, no drop shadow, no snapping — is out of date for the Tauri this
//! app builds against (2.11, tao 0.35): an undecorated window keeps
//! `WS_THICKFRAME`, so DWM still rounds the corners and draws the shadow, the
//! system still snaps it, and tao still hands it the resize borders. What the
//! platform flag buys is that tao stops reserving a title bar's worth of
//! non-client area at the top.
//!
//! ## Why the style bits are *also* touched
//!
//! `strip_caption` clears `WS_CAPTION` from the window style on top of that, and
//! that is not a leftover: it is what makes the frame 2px instead of 8px.
//!
//! `WS_CAPTION` decides whether DWM gives the window a frame with an *invisible*
//! border. With the caption in the style (the state `decorations: false` leaves
//! it in, because tao keeps the bit and only overrides `WM_NCCALCSIZE`), the
//! window rectangle *is* the visible rectangle, and tao's own client inset —
//! `SM_CXSIZEFRAME + SM_CXPADDEDBORDER`, 8px at 100% — is 8px of frame the app
//! can never use. With the caption gone, DWM insets the visible frame 6px inside
//! the window rectangle, the window grows the invisible border that
//! `DWMWA_EXTENDED_FRAME_BOUNDS` exists to hide, and the same 8px inset lands 2px
//! inside the visible edge instead of 8px.
//!
//! So the strip ends 2px from the top of the window, not 30-odd, and hovering the
//! close button draws its red to within 2px of the corner that Windows rounds.
//! The last stitch is `strip_caption`'s other effect, below.
//!
//! ## What is left for this module
//!
//! Two things, both idempotent, both applied from `setup` (before the first
//! paint), again from `on_page_load` (for the windows `setup` cannot see: the
//! notes column, a note reference, and a second copy from File → Open in New
//! Window), and again from `RunEvent::Ready`, `WindowEvent::Focused(true)` and
//! `WindowEvent::Resized(_)`. The late calls matter: a packaged build was
//! measured with `WS_CAPTION` still set after the first two hooks, which left
//! the 8 px frame and its unpainted ring exactly as they were before any of this
//! code ran, and tao can put the bit back while maximizing or restoring.
//!
//! 1. **The 1px ring inside the frame.** tao insets the client by a hair more
//!    than DWM's visible border — 2px inside it on three sides, 1px on the top —
//!    and nothing paints the difference: the window class has no background
//!    brush, so the ring showed whatever the compositor had, a white hairline
//!    down the sides of a dark window. `frame_proc` fills it with the strip's
//!    colour. Filling the whole window DC is safe: the client area belongs to the
//!    webview's child window, which paints itself over the parent's pixels, so
//!    only the ring keeps the fill.
//! 2. **The frame's colour.** DWM's border is the system's light grey.
//!    `DWMWA_BORDER_COLOR` is pointed at the same colour as the strip so the
//!    outline reads as part of the app's chrome rather than as a lit edge around
//!    it. `SWP_FRAMECHANGED` is what makes DWM rebuild the frame with the colour,
//!    so the two calls travel together — and it is also what hands the newly
//!    stripped style its new non-client metrics, which is why the strip does not
//!    need a second one.
//!
//! Everything here is a no-op off Windows, so the project keeps being developed
//! and tested on macOS.
//!
//! The bar itself is `App`'s first row and takes its height from the CSS, so
//! nothing in this module sizes it. The one thing that had to go was the CSS idea
//! of a traffic-light gutter: on Windows the strip starts at the window's own edge
//! (`html[data-os="windows"] .titlebar` in `src/App.css`) and the window buttons
//! end at the other one, which is what puts the close button's hover fill on the
//! rounded corner in the first place. What is left of that corner is the frame —
//! one pixel of it at the top, two on the other three sides — and it is entirely
//! the app's colour.

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;

    type HWND = *mut c_void;
    type HDC = *mut c_void;
    type HBRUSH = *mut c_void;

    const GWL_STYLE: i32 = -16;
    /// `WS_BORDER | WS_DLGFRAME`: the caption, and the border drawn around it.
    const WS_CAPTION: i32 = 0x00C0_0000;

    /// `WM_NCPAINT`: the window is asked to paint its own frame.
    const WM_NCPAINT: u32 = 0x0085;

    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_FRAMECHANGED: u32 = 0x0020;

    /// Our entry in the window's subclass chain. Any value works as long as it is
    /// the same on every call: registering an id already in the chain *replaces*
    /// that entry, which is what makes `apply` idempotent.
    const SUBCLASS_ID: usize = 0x5046_5657; // "PFVW"

    const DWMWA_BORDER_COLOR: u32 = 34;
    /// `COLORREF` (`0x00BBGGRR`) for `--bg-elev` in `src/App.css` (`#323237`).
    /// Keep the two in step: this is the window's frame and the ring inside it,
    /// and both have to read as the same surface as the strip they surround.
    const FRAME_COLORREF: u32 = 0x0037_3232;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    /// `SUBCLASSPROC`, as `comctl32` declares it.
    type SubclassProc =
        Option<unsafe extern "system" fn(HWND, u32, usize, isize, usize, usize) -> isize>;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetWindowLongW(hwnd: HWND, index: i32) -> i32;
        fn SetWindowLongW(hwnd: HWND, index: i32, value: i32) -> i32;
        fn GetWindowRect(hwnd: HWND, rect: *mut Rect) -> i32;
        fn GetWindowDC(hwnd: HWND) -> HDC;
        fn ReleaseDC(hwnd: HWND, hdc: HDC) -> i32;
        fn FillRect(hdc: HDC, rect: *const Rect, brush: HBRUSH) -> i32;
        fn SetWindowPos(
            hwnd: HWND,
            insert_after: HWND,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            flags: u32,
        ) -> i32;
    }

    #[link(name = "gdi32")]
    unsafe extern "system" {
        fn CreateSolidBrush(color: u32) -> HBRUSH;
        fn DeleteObject(object: *mut c_void) -> i32;
    }

    #[link(name = "comctl32")]
    unsafe extern "system" {
        fn SetWindowSubclass(hwnd: HWND, proc: SubclassProc, id: usize, data: usize) -> i32;
        fn DefSubclassProc(hwnd: HWND, msg: u32, wparam: usize, lparam: isize) -> isize;
    }

    #[link(name = "dwmapi")]
    unsafe extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: HWND,
            attribute: u32,
            value: *const c_void,
            size: u32,
        ) -> i32;
    }

    /// Paint the ring between the webview and the frame in the strip's colour.
    ///
    /// The whole window rectangle is filled rather than just the ring: the client
    /// area is a child window (the webview) and paints itself over these pixels,
    /// so only the part of the parent's surface that nothing else covers — the
    /// frame — keeps the fill. Measuring the ring and painting exactly it would
    /// be the same pixels for more code.
    unsafe fn paint_frame(hwnd: HWND) {
        let mut window = Rect::default();
        if GetWindowRect(hwnd, &mut window) == 0 {
            return;
        }
        let hdc = GetWindowDC(hwnd);
        if hdc.is_null() {
            return;
        }
        let brush = CreateSolidBrush(FRAME_COLORREF);
        if !brush.is_null() {
            let size = Rect {
                left: 0,
                top: 0,
                right: window.right - window.left,
                bottom: window.bottom - window.top,
            };
            FillRect(hdc, &size, brush);
            DeleteObject(brush);
        }
        ReleaseDC(hwnd, hdc);
    }

    /// The window's subclass procedure: the frame, and nothing else.
    ///
    /// Everything else goes down the chain, which is where tao handles the window
    /// (its own subclass is older than this one, so `DefSubclassProc` reaches it).
    unsafe extern "system" fn frame_proc(
        hwnd: HWND,
        msg: u32,
        wparam: usize,
        lparam: isize,
        _id: usize,
        _data: usize,
    ) -> isize {
        if msg == WM_NCPAINT {
            paint_frame(hwnd);
            return 0;
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    /// Take the caption out of the window style.
    ///
    /// The frame's whole geometry hangs off this bit (see the module docs), and
    /// it has to be cleared before the window is first painted, or the startup
    /// shows the system frame it was created with. Idempotent: the page-load hook
    /// can fire more than once for a window (a reload), and re-running this only
    /// reports that the caption is already gone.
    unsafe fn strip_caption(hwnd: HWND) -> bool {
        let style = GetWindowLongW(hwnd, GWL_STYLE);
        if style & WS_CAPTION == 0 {
            return false;
        }
        SetWindowLongW(hwnd, GWL_STYLE, style & !WS_CAPTION);
        // `apply` owns the single `SWP_FRAMECHANGED` after this: a frame change
        // here as well would repaint the frame twice on the first pass.
        true
    }

    /// Take over the frame of `hwnd`: its shape, its colour, and the ring inside
    /// it.
    pub fn apply(hwnd: HWND) {
        if hwnd.is_null() {
            return;
        }
        unsafe {
            // Before the style changes: `SWP_FRAMECHANGED` repaints the frame, and
            // the repaint has to find this in the chain.
            let installed = SetWindowSubclass(hwnd, Some(frame_proc), SUBCLASS_ID, 0) != 0;

            // The common case after startup is a resize/maximize notification on
            // a window that is already finished. `apply` must be cheap there:
            // `SetWindowPos` and a full-window DC fill on every resize step would
            // flash. Only the first install or a re-added caption needs work.
            if !installed && GetWindowLongW(hwnd, GWL_STYLE) & WS_CAPTION == 0 {
                return;
            }

            let color = FRAME_COLORREF;
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_BORDER_COLOR,
                &color as *const u32 as *const c_void,
                4,
            );

            let stripped = strip_caption(hwnd);

            // DWM only reads the border colour when it builds a frame, and the
            // first build may have come before this call. The frame change is
            // what makes the tint stick without waiting for a resize; it is also
            // what gives the newly stripped style its final non-client metrics.
            //
            // Run it on the first install and whenever the caption was still
            // there. A later call on an already-finished window must not force a
            // frame change on every focus: that would flash the whole frame.
            if installed || stripped {
                SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
                );
            }

            // `WM_NCPAINT` normally does this, but the frame may already have been
            // painted before the subclass was installed — and on an inactive
            // window Windows can skip the paint entirely. Calling it directly
            // covers the 1 px ring on the first apply and on every re-apply.
            paint_frame(hwnd);
        }
    }
}

/// Give `webview`'s window the app's frame. No-op off Windows.
///
/// Takes the webview rather than the window so both entry points can call it:
/// `setup` has the main `WebviewWindow` (`AsRef<Webview>`), and `on_page_load`
/// has a bare `Webview` for every window the app opens later.
#[cfg(windows)]
pub fn apply_window_chrome<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    // A window whose native handle cannot be read yet is finished by its
    // `on_page_load` instead, so there is nothing to fail over here.
    if let Ok(hwnd) = webview.window().hwnd() {
        imp::apply(hwnd.0);
    }
}

#[cfg(not(windows))]
pub fn apply_window_chrome<R: tauri::Runtime>(_webview: &tauri::Webview<R>) {}

/// Re-apply the frame to `window` after it has been shown or focused.
///
/// `apply_window_chrome` runs from `setup` and `on_page_load`, which can be
/// earlier than tao's final style pass: the measured release build still had
/// `WS_CAPTION` set after both hooks, so the 8 px frame and its unpainted ring
/// survived until something touched the window. This entry point is called from
/// `RunEvent::Ready` and `WindowEvent::Focused(true)` in `lib.rs`, after the
/// window exists for real. No-op off Windows.
#[cfg(windows)]
pub fn apply_window_chrome_for_window<R: tauri::Runtime>(window: &tauri::Window<R>) {
    if let Ok(hwnd) = window.hwnd() {
        imp::apply(hwnd.0);
    }
}

#[cfg(not(windows))]
pub fn apply_window_chrome_for_window<R: tauri::Runtime>(_window: &tauri::Window<R>) {}
