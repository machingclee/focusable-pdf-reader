//! The macOS Dock's right-click menu.
//!
//! File → Open in New Window lives on the menu bar, which the webview installs.
//! A right-click on the Dock icon asks the application delegate for a different
//! menu (`applicationDockMenu:`), and Tauri 2 does not set one, so the Dock
//! shows only the window list and Quit.
//!
//! The delegate is tao's `TaoAppDelegateParent`. This module adds the Dock
//! method to that class and a second method the menu item calls. The window it
//! opens is the same copy File → Open in New Window opens: label prefix `app-`,
//! the same size, the same cascade. Those numbers are mirrored in
//! `windowBridge.ts` (`openAppWindow`).

/// Same size the main window is created with (`tauri.conf.json`).
const APP_WINDOW_WIDTH: f64 = 1200.0;
const APP_WINDOW_HEIGHT: f64 = 860.0;
/// How far each additional copy steps down and right, in logical px.
const CASCADE_PX: f64 = 26.0;
/// How many steps the cascade takes before the windows share a corner.
const MAX_CASCADE: usize = 3;

/// Where a new copy of the app sits.
///
/// `steps` is how many cascade steps it takes. The original window is not one
/// of them: the first extra window already takes one step, so it is not exactly
/// on top of the window the reader already has. `work_*` is the monitor's work
/// area (the screen minus the menu bar and the Dock) in logical pixels.
pub struct AppWindowFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn app_window_frame(
    steps: usize,
    work_x: f64,
    work_y: f64,
    work_w: f64,
    work_h: f64,
) -> AppWindowFrame {
    let step = (steps.min(MAX_CASCADE) as f64) * CASCADE_PX;
    let width = APP_WINDOW_WIDTH.min((work_w * 0.92).round());
    let height = APP_WINDOW_HEIGHT.min((work_h * 0.9).round());
    AppWindowFrame {
        width,
        height,
        x: ((work_w - width) / 2.0).round() + step + work_x,
        y: ((work_h - height) / 2.0).round() + step + work_y,
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{app_window_frame, AppWindowFrame};
    use objc2::ffi::class_addMethod;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
    use objc2::{sel, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSMenu, NSMenuItem};
    use objc2_foundation::NSString;
    use std::ffi::CStr;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tauri::{AppHandle, Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

    static APP: Mutex<Option<AppHandle>> = Mutex::new(None);
    static OPENING: AtomicBool = AtomicBool::new(false);
    static SEQ: AtomicU64 = AtomicU64::new(0);

    pub fn install(app: &AppHandle) {
        *APP.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(app.clone());

        let Some(class) = AnyClass::get(c"TaoAppDelegateParent") else {
            eprintln!(
                "[dock] TaoAppDelegateParent is not registered; the Dock has no Open in New Window"
            );
            return;
        };

        // Both methods have to be on the delegate. The Dock asks *it* for the
        // menu, and the menu item's target is the delegate too: a target that
        // the Dock does not keep alive would leave the item greyed out.
        add(class, sel!(applicationDockMenu:), dock_menu_imp(), c"@@:@");
        add(class, sel!(openNewWindow:), open_new_window_imp(), c"v@:@");
    }

    fn add(class: &AnyClass, sel: Sel, imp: Imp, types: &CStr) {
        if class.instance_method(sel).is_some() {
            return;
        }
        let added: Bool = unsafe {
            class_addMethod(
                std::ptr::from_ref(class).cast_mut(),
                sel,
                imp,
                types.as_ptr(),
            )
        };
        if !added.as_bool() {
            eprintln!(
                "[dock] could not add -[{} {sel}]",
                class.name().to_string_lossy()
            );
        }
    }

    fn dock_menu_imp() -> Imp {
        unsafe {
            std::mem::transmute(
                application_dock_menu
                    as unsafe extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> *mut NSMenu,
            )
        }
    }

    fn open_new_window_imp() -> Imp {
        unsafe {
            std::mem::transmute(
                open_new_window as unsafe extern "C-unwind" fn(&AnyObject, Sel, &AnyObject),
            )
        }
    }

    /// What the Dock calls on right-click. The system adds the window list and
    /// Quit underneath whatever this returns.
    unsafe extern "C-unwind" fn application_dock_menu(
        this: &AnyObject,
        _cmd: Sel,
        _sender: &AnyObject,
    ) -> *mut NSMenu {
        match build_dock_menu(this) {
            Some(menu) => Retained::autorelease_return(menu),
            None => std::ptr::null_mut(),
        }
    }

    fn build_dock_menu(delegate: &AnyObject) -> Option<Retained<NSMenu>> {
        let mtm = MainThreadMarker::new()?;
        let menu = NSMenu::new(mtm);
        // The Dock enables an item only when its target implements the action.
        // Leaving that to the responder chain greys the item out, because the
        // Dock's menu is not attached to a window.
        menu.setAutoenablesItems(false);

        let item = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(mtm),
                &NSString::from_str("Open in New Window"),
                Some(sel!(openNewWindow:)),
                &NSString::from_str("n"),
            )
        };
        item.setEnabled(true);
        unsafe { item.setTarget(Some(delegate)) };
        menu.addItem(&item);
        Some(menu)
    }

    unsafe extern "C-unwind" fn open_new_window(_this: &AnyObject, _cmd: Sel, _sender: &AnyObject) {
        let Ok(_) = std::panic::catch_unwind(open_from_dock) else {
            eprintln!("[dock] opening a new window panicked");
            return;
        };
    }

    fn open_from_dock() {
        let app = APP
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let Some(app) = app else {
            eprintln!("[dock] Open in New Window was clicked before the app finished launching");
            return;
        };
        if let Err(error) = open_app_window(&app) {
            eprintln!("[dock] could not open a new window: {error}");
        }
    }

    fn open_app_window(app: &AppHandle) -> Result<(), String> {
        // One click, one window. A second click while the webview is still
        // being created would otherwise stack two on the same spot. The flag
        // clears on drop so a panic does not leave the item dead.
        if OPENING.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        let _release = ReleaseOpening;
        let result = (|| {
            let seq = SEQ.fetch_add(1, Ordering::Relaxed);
            let millis = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|elapsed| elapsed.as_millis())
                .unwrap_or(0);
            let label = format!("app-{millis:x}-{seq}");
            let open = app
                .webview_windows()
                .keys()
                .filter(|label| label.starts_with("app-"))
                .count();
            let frame = frame_on_primary(app, open + 1);
            WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
                .title("PDF Focus Viewer")
                .inner_size(frame.width, frame.height)
                .min_inner_size(720.0, 480.0)
                .position(frame.x, frame.y)
                .title_bar_style(TitleBarStyle::Overlay)
                .hidden_title(true)
                .allow_link_preview(false)
                .focused(true)
                .build()
                .map(|_| ())
                .map_err(|error| error.to_string())
        })();
        result
    }

    struct ReleaseOpening;

    impl Drop for ReleaseOpening {
        fn drop(&mut self) {
            OPENING.store(false, Ordering::Release);
        }
    }

    fn frame_on_primary(app: &AppHandle, steps: usize) -> AppWindowFrame {
        // The same fallback `openAppWindow` uses when the browser has no screen.
        let (x, y, width, height) = match app.primary_monitor() {
            Ok(Some(monitor)) => {
                let scale = monitor.scale_factor();
                let area = monitor.work_area();
                let origin = area.position.to_logical::<f64>(scale);
                let size = area.size.to_logical::<f64>(scale);
                (origin.x, origin.y, size.width, size.height)
            }
            _ => (0.0, 0.0, 1440.0, 900.0),
        };
        app_window_frame(steps, x, y, width, height)
    }
}

#[cfg(target_os = "macos")]
pub use macos::install;

#[cfg(test)]
mod tests {
    use super::app_window_frame;

    #[test]
    fn the_first_copy_steps_off_center() {
        // 1440×800 work area starting under a 25px menu bar. The window stays
        // 1200 wide (the screen is wide enough) and shrinks to 720 tall.
        let frame = app_window_frame(1, 0.0, 25.0, 1440.0, 800.0);
        assert_eq!(frame.width, 1200.0);
        assert_eq!(frame.height, 720.0);
        assert_eq!(frame.x, (1440.0 - 1200.0) / 2.0 + 26.0);
        assert_eq!(frame.y, 25.0 + (800.0 - 720.0) / 2.0 + 26.0);
    }

    #[test]
    fn the_cascade_stops_at_three_steps() {
        let third = app_window_frame(3, 0.0, 0.0, 2000.0, 1200.0);
        let later = app_window_frame(9, 0.0, 0.0, 2000.0, 1200.0);
        assert_eq!(third.width, 1200.0);
        assert_eq!(third.height, 860.0);
        assert_eq!(third.x, (2000.0 - 1200.0) / 2.0 + 78.0);
        assert_eq!(third.y, (1200.0 - 860.0) / 2.0 + 78.0);
        assert_eq!(later.x, third.x);
        assert_eq!(later.y, third.y);
    }

    #[test]
    fn a_small_display_shrinks_the_window() {
        let frame = app_window_frame(0, 10.0, 20.0, 800.0, 600.0);
        assert_eq!(frame.width, (800.0_f64 * 0.92).round());
        assert_eq!(frame.height, (600.0_f64 * 0.9).round());
        assert_eq!(frame.x, 10.0 + ((800.0 - frame.width) / 2.0).round());
        assert_eq!(frame.y, 20.0 + ((600.0 - frame.height) / 2.0).round());
    }
}
