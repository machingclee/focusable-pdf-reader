//! Windows window chrome: no native title bar.
//!
//! macOS has never drawn a title bar for this app. `titleBarStyle: "Overlay"`
//! plus `hiddenTitle: true` in `tauri.conf.json` leaves the traffic lights
//! floating over the content, and the app's own strip
//! (`src/components/TitleBar.tsx`) is the only bar the window has. Both of those
//! settings are macOS-only, so Windows kept the standard caption — app icon,
//! title, minimise / maximise / close — stacked on top of that strip: two bars,
//! and the upper one is not the one the design asked for.
//!
//! `decorations: false` would take the caption away, but it takes the resize
//! frame with it: no edge to drag, no drop shadow, no window snapping, and the
//! drag/resize behaviour would have to be rebuilt by hand. So the caption is
//! removed from the *style bits* instead, keeping `WS_THICKFRAME` — the same
//! trick the FF14 P4 Calculator uses in `win32.rs` (`apply_compact_chrome`),
//! which drops `WS_CAPTION_BUTTONS` and leaves Windows' own frame to size and
//! snap the window.
//!
//! What is left after `WS_CAPTION` goes is a window with no non-client caption
//! area at all: the webview starts at the top edge, Windows still resizes and
//! snaps it, and the window's own strip is the only bar. The three buttons the
//! caption used to carry are drawn by the app instead (`WindowControls`), which
//! is why this module only ever *removes* chrome.
//!
//! Everything here is a no-op off Windows, so the project keeps being developed
//! and tested on macOS.

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;

    type HWND = *mut c_void;

    const GWL_STYLE: i32 = -16;
    /// `WS_BORDER | WS_DLGFRAME`: the caption, and the border drawn around it.
    const WS_CAPTION: i32 = 0x00C0_0000;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_FRAMECHANGED: u32 = 0x0020;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetWindowLongW(hWnd: HWND, nIndex: i32) -> i32;
        fn SetWindowLongW(hWnd: HWND, nIndex: i32, dwNewLong: i32) -> i32;
        fn SetWindowPos(
            hWnd: HWND,
            hWndInsertAfter: HWND,
            X: i32,
            Y: i32,
            cx: i32,
            cy: i32,
            uFlags: u32,
        ) -> i32;
    }

    /// Take the caption out of the window style, keeping the thick frame.
    ///
    /// Idempotent: the page-load hook can fire more than once for a window (a
    /// reload), and re-running this would only report "already stripped".
    pub fn strip_caption(hwnd: HWND) {
        if hwnd.is_null() {
            return;
        }
        unsafe {
            let style = GetWindowLongW(hwnd, GWL_STYLE);
            if style & WS_CAPTION == 0 {
                return;
            }
            SetWindowLongW(hwnd, GWL_STYLE, style & !WS_CAPTION);
            // Without `SWP_FRAMECHANGED` Windows keeps the non-client metrics it
            // cached at creation, so the caption's height stays reserved and the
            // webview keeps starting 30-odd pixels down. This is the call that
            // makes it recompute them and hand the space to the client area.
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
    }
}

/// Remove the native title bar from `webview`'s window. No-op off Windows.
///
/// Takes the webview rather than the window so both entry points can call it:
/// `setup` has the main `WebviewWindow` (`AsRef<Webview>`), and `on_page_load`
/// has a bare `Webview` for every window the app opens later.
#[cfg(windows)]
pub fn hide_native_title_bar<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    // A window whose native handle cannot be read yet is stripped by its
    // `on_page_load` instead, so there is nothing to fail over here.
    if let Ok(hwnd) = webview.window().hwnd() {
        imp::strip_caption(hwnd.0);
    }
}

#[cfg(not(windows))]
pub fn hide_native_title_bar<R: tauri::Runtime>(_webview: &tauri::Webview<R>) {}
