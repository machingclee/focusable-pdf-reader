//! Tauri shell around the Bun backend.
//!
//! In a packaged build the backend runs as a sidecar: Rust starts it, reads the
//! `BACKEND_READY port=<n>` line it prints, and hands the address to the webview
//! through the `get_backend_info` command and the `backend-ready` event.
//! In development the backend is started separately (`npm run dev:backend`,
//! `bun --watch` on port 4317) and the frontend uses `VITE_BACKEND_PORT`, so
//! nothing is spawned here.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

mod dock_menu;
mod win32;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Sidecar name from `bundle.externalBin` (without the target triple suffix).
const SIDECAR: &str = "pdf-backend";
/// The single line the backend writes to stdout once it listens.
const READY_PREFIX: &str = "BACKEND_READY port=";
/// How long `get_backend_info` waits for that line before giving up.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);
/// Event name the webview can listen for instead of calling the command.
const READY_EVENT: &str = "backend-ready";

/// What the webview needs in order to talk to the backend.
#[derive(Clone, Debug, Serialize)]
struct BackendInfo {
    /// Port the backend listens on; chosen by the OS because Rust passes `PORT=0`.
    port: u16,
    /// Shared secret the backend requires in `X-Backend-Token`, if one was generated.
    token: Option<String>,
}

/// Shared background process state.
#[derive(Default)]
struct BackendState {
    /// Set once the sidecar reported its port, cleared if it exits.
    info: Mutex<Option<BackendInfo>>,
    /// Handle used to stop the sidecar when the app exits.
    child: Mutex<Option<CommandChild>>,
    /// Why the sidecar could not start or died before reporting a port.
    failure: Mutex<Option<String>>,
}

/// The windows that close together with `closed`.
///
/// The original window takes its notes column and every note-reference viewer
/// with it. A copy opened with File → Open in New Window takes only its own
/// notes column (`notes-` plus its label). A reference viewer closes alone.
fn companion_labels(closed: &str, open: &[String]) -> Vec<String> {
    let mut close = Vec::new();
    if closed == "main" {
        if open.iter().any(|label| label == "notes") {
            close.push("notes".to_string());
        }
        close.extend(
            open.iter()
                .filter(|label| label.starts_with("viewer-note-"))
                .cloned(),
        );
    } else if closed.starts_with("app-") {
        let notes = format!("notes-{closed}");
        if open.iter().any(|label| label == &notes) {
            close.push(notes);
        }
    }
    close
}

/// Parse `BACKEND_READY port=12345`, tolerating surrounding whitespace and CRLF.
fn parse_ready_line(line: &str) -> Option<u16> {
    let port = line.trim().strip_prefix(READY_PREFIX)?.trim();
    port.parse::<u16>().ok().filter(|port| *port > 0)
}

/// 32 random bytes as hex. A guessable token would be worse than none, so a
/// failure to read randomness is reported and the backend starts without one.
fn generate_token() -> Option<String> {
    let mut bytes = [0u8; 32];
    match getrandom::fill(&mut bytes) {
        Ok(()) => Some(bytes.iter().map(|byte| format!("{byte:02x}")).collect()),
        Err(error) => {
            eprintln!("[backend] no randomness for an API token, starting without one: {error}");
            None
        }
    }
}

fn set_failure(app: &AppHandle, message: String) {
    eprintln!("[backend] {message}");
    let state = app.state::<BackendState>();
    *state.failure.lock().unwrap() = Some(message);
}

/// The event-storming diagram bundled at `$RESOURCES/event-storming` by
/// `bundle.resources` in `tauri.conf.json`, if it is really there.
///
/// The sidecar is a `bun build --compile` executable. Its copy of
/// `@machingclee/express-cqrs` looks for the diagram next to its own module,
/// which inside a compiled binary is Bun's embedded filesystem
/// (`file:///$bunfs/root/...`) and holds JavaScript only — `express.static`
/// cannot read from it — and the package's other guess is
/// `./src/event-storming/public` under the working directory, which for a
/// double-clicked `.app` is `/`. That is why `/event-storming` answered with the
/// "not built yet" page even though the npm package ships the build:
/// `dist/event-storming/public` is real on disk, but not inside the executable.
///
/// `EVENT_STORMING_DIR` is the package's documented hook for exactly this case.
fn event_storming_dir(app: &AppHandle) -> Option<PathBuf> {
    // A directory only counts when it holds an `index.html`, the same test the
    // package applies, so a half-copied resource falls back to its hint page.
    let dir = app.path().resource_dir().ok()?.join("event-storming");
    dir.join("index.html").is_file().then_some(dir)
}

/// Spawn the sidecar and pump its stdout/stderr until it exits.
fn start_sidecar(app: &AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve the app data directory: {error}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|error| format!("cannot create {}: {error}", data_dir.display()))?;
    let database_url = format!("file:{}/database.db", data_dir.display());

    let token = generate_token();
    let mut command = app
        .shell()
        .sidecar(SIDECAR)
        .map_err(|error| format!("cannot find the {SIDECAR} sidecar: {error}"))?
        .env("PORT", "0")
        .env("DATABASE_URL", database_url)
        // Backstop: if this process dies without killing the child, the child
        // sees its stdin close and exits.
        .env("BACKEND_STDIN_WATCHDOG", "1");
    if let Some(token) = token.clone() {
        command = command.env("BACKEND_TOKEN", token);
    }
    match event_storming_dir(app) {
        Some(dir) => command = command.env("EVENT_STORMING_DIR", dir),
        // Not fatal: the backend keeps running and `/event-storming` explains
        // what is missing, which beats a window that refuses to open.
        None => eprintln!(
            "[backend] no bundled event-storming diagram in the resources directory; \
             /event-storming will show its build instructions"
        ),
    }

    let (mut events, child) = command
        .spawn()
        .map_err(|error| format!("cannot start the {SIDECAR} sidecar: {error}"))?;

    app.state::<BackendState>().child.lock().unwrap().replace(child);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    match parse_ready_line(line) {
                        Some(port) => {
                            let info = BackendInfo { port, token: token.clone() };
                            let state = app_handle.state::<BackendState>();
                            *state.info.lock().unwrap() = Some(info.clone());
                            if let Err(error) = app_handle.emit(READY_EVENT, &info) {
                                eprintln!("[backend] could not emit {READY_EVENT}: {error}");
                            }
                            eprintln!("[backend] sidecar listening on port {port}");
                        }
                        // Anything else on stdout is backend chatter; keep it visible.
                        None => eprintln!("[backend] {line}"),
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    let text = text.trim_end();
                    if !text.is_empty() {
                        eprintln!("[backend] {text}");
                    }
                }
                CommandEvent::Error(error) => set_failure(&app_handle, format!("sidecar error: {error}")),
                CommandEvent::Terminated(payload) => {
                    let state = app_handle.state::<BackendState>();
                    *state.info.lock().unwrap() = None;
                    if state.failure.lock().unwrap().is_none() {
                        *state.failure.lock().unwrap() = Some(format!(
                            "the backend exited (code {:?}, signal {:?})",
                            payload.code, payload.signal
                        ));
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Port and token of the running backend, waiting for startup if necessary.
#[tauri::command]
async fn get_backend_info(state: State<'_, BackendState>) -> Result<BackendInfo, String> {
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    loop {
        if let Some(info) = state.info.lock().unwrap().clone() {
            return Ok(info);
        }
        if let Some(failure) = state.failure.lock().unwrap().clone() {
            return Err(failure);
        }
        if Instant::now() >= deadline {
            return Err("the backend did not report a port within 20 seconds".to_string());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Open a file in VS Code via the vscode:// URL scheme.
/// Used by TauriClickToComponent in dev mode — WKWebView can't navigate
/// vscode:// URLs directly, so the frontend invokes this command instead.
#[tauri::command]
async fn open_in_vscode(app: tauri::AppHandle, path: String) -> Result<(), String> {
    // VS Code wants vscode://file/C:/path on Windows; backslashes break the URL.
    let path = path.replace('\\', "/");
    let url = if path.starts_with('/') {
        format!("vscode://file{}", path)
    } else {
        format!("vscode://file/{}", path)
    };
    app.opener()
        .open_url(&url, None::<String>)
        .map_err(|e| e.to_string())
}

/// The folder pasted note pictures are stored in.
///
/// A pasted picture is not part of the remark: the note stores
/// `images/<filename>` and every viewer asks for this directory to turn that
/// into a file. Dev writes into the repo at `backend/images`. A packaged build
/// writes beside its database, in the app data directory. The filename is the
/// only thing the remark remembers, so a picture pasted in one mode is not
/// visible in the other.
fn images_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = if tauri::is_dev() {
        // `src-tauri` is the manifest dir, in dev and after a rebuild, so this
        // does not depend on the process's working directory.
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend/images")
    } else {
        app.path()
            .app_data_dir()
            .map_err(|error| format!("cannot resolve the app data directory: {error}"))?
            .join("images")
    };
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("could not create the images directory: {error}"))?;
    // Drop the `..` so the asset protocol matches the path the webview requests.
    dir.canonicalize()
        .map_err(|error| format!("could not resolve the images directory: {error}"))
}

/// The directory pasted note pictures are written to. Created if it is missing.
#[tauri::command]
async fn get_images_dir(app: AppHandle) -> Result<String, String> {
    Ok(images_dir(&app)?.to_string_lossy().to_string())
}

/// Write one pasted PNG and return its filename, not its path.
///
/// The markdown only ever says `images/<filename>`. The directory is this
/// machine's, so it stays out of the note.
#[tauri::command]
async fn save_pasted_image(app: AppHandle, data: Vec<u8>) -> Result<String, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0);
    let filename = format!("image-{stamp}.png");
    let path = images_dir(&app)?.join(&filename);
    std::fs::write(&path, &data).map_err(|error| format!("could not write the pasted image: {error}"))?;
    Ok(filename)
}

/// An image read off the system clipboard, as raw RGBA.
#[derive(Serialize)]
struct ClipboardImageData {
    width: usize,
    height: usize,
    /// Raw RGBA bytes, row-major.
    rgba: Vec<u8>,
}

/// Read an image from the system clipboard.
///
/// Returns nothing when the clipboard holds no image. Doing this here, rather
/// than through the webview, is what avoids the macOS clipboard permission
/// dialog on every paste.
#[tauri::command]
fn read_clipboard_image() -> Option<ClipboardImageData> {
    let mut clipboard = arboard::Clipboard::new().ok()?;
    let image = clipboard.get_image().ok()?;
    Some(ClipboardImageData {
        width: image.width,
        height: image.height,
        rgba: image.bytes.into_owned(),
    })
}

/// Read plain text from the system clipboard.
///
/// Paste in a note editor is handled as one key, image first and text
/// otherwise, so text has to come from the same place as the image or a
/// picture-less paste would be swallowed.
#[tauri::command]
fn read_clipboard_text() -> Option<String> {
    let mut clipboard = arboard::Clipboard::new().ok()?;
    clipboard.get_text().ok()
}

/// Write an HTML export to a temporary file and open it in the default browser.
///
/// The notes export is a reading copy, not a document the reader has to file
/// away, so it takes the road a "view as HTML" link would: a throwaway file the
/// system's browser opens. Doing the write here rather than in the webview also
/// keeps the app's filesystem scope out of it — nothing outside `std::env::temp_dir`
/// is touched — and means the path never depends on a save dialog. The temporary
/// path is returned so the UI can say where the file went.
#[tauri::command]
async fn write_and_open_html(app: AppHandle, html: String) -> Result<String, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0);

    let path = std::env::temp_dir().join(format!("pdf-focus-viewer-notes-{stamp}.html"));
    std::fs::write(&path, html.as_bytes())
        .map_err(|error| format!("could not write the notes export: {error}"))?;

    let path_string = path.to_string_lossy().to_string();
    app.opener()
        .open_path(path_string.clone(), None::<String>)
        .map_err(|error| format!("could not open the notes export: {error}"))?;

    Ok(path_string)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![
            open_in_vscode,
            write_and_open_html,
            get_backend_info,
            get_images_dir,
            save_pasted_image,
            read_clipboard_image,
            read_clipboard_text
        ])
        // Closing a window closes the notes column it popped out, and closing
        // the original window also closes the note-reference viewers it opened.
        // A window from File → Open in New Window is another copy of the app:
        // it stays, and it takes its own notes window with it when *it* closes.
        //
        // The prefixes mirror `windowBridge.ts`, which is where the windows are
        // named.
        .on_window_event(|window, event| {
            // `on_page_load` can beat tao's final style pass, leaving
            // `WS_CAPTION` set and the 8 px frame (with its light 1 px ring) in
            // place. A focus event only arrives once the window is real, so this
            // is the second chance to strip it and paint the ring. Resize is the
            // third: tao can put the caption bit back while maximizing or
            // restoring, and that would return the line after a successful
            // startup. `apply` returns immediately when neither is needed.
            if matches!(
                event,
                tauri::WindowEvent::Focused(true) | tauri::WindowEvent::Resized(_)
            ) {
                win32::apply_window_chrome_for_window(window);
                return;
            }
            if !matches!(event, tauri::WindowEvent::Destroyed) {
                return;
            }
            let app = window.app_handle();
            // Collected first: closing while holding the map's borrow is not
            // allowed, and closing one window can change it.
            let open: Vec<String> = app.webview_windows().keys().cloned().collect();
            for label in companion_labels(window.label(), &open) {
                if let Some(companion) = app.get_webview_window(&label) {
                    let _ = companion.close();
                }
            }
        })
        // The strip that replaces the native title bar belongs to the app
        // (`src/components/TitleBar.tsx`); what is left for Windows to do is
        // paint the window's frame as the app's own (see `win32`). That covers
        // the windows `setup` cannot see: the notes column, a note reference,
        // and a second copy from File → Open in New Window.
        .on_page_load(|webview, _payload| {
            win32::apply_window_chrome(webview);
        })
        .setup(|app| {
            // The File menu is installed by the webview. The Dock's right-click
            // menu is not that menu, and Tauri has no API for it.
            #[cfg(target_os = "macos")]
            dock_menu::install(app.handle());

            // The main window's frame is taken over here rather than at its
            // first page load: the frame has to be the app's before it is first
            // painted, or the startup shows the system's grey border around a
            // dark window. A no-op on macOS, where the window keeps the system's
            // own frame and `titleBarStyle: "Overlay"` floats the traffic lights
            // over the content.
            if let Some(main) = app.get_webview_window("main") {
                win32::apply_window_chrome(main.as_ref());
            }

            if tauri::is_dev() {
                // The configured asset scope is the app-data images folder. Dev
                // pictures live in the repo, so that folder has to be allowed
                // too or the webview cannot show them.
                match images_dir(app.handle()) {
                    Ok(dir) => {
                        if let Err(error) = app.asset_protocol_scope().allow_directory(&dir, false) {
                            eprintln!("[images] could not allow {}: {error}", dir.display());
                        }
                    }
                    Err(error) => eprintln!("[images] {error}"),
                }
                eprintln!(
                    "[backend] dev mode: start the backend with `npm run dev:backend` \
                     (http://127.0.0.1:4317); no sidecar is spawned"
                );
            } else if let Err(error) = start_sidecar(app.handle()) {
                set_failure(app.handle(), error);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // The event loop is up and the initial windows are fully created here,
        // after the style pass that can overwrite `strip_caption`'s work. Apply
        // once more before the first ordinary focus event.
        if matches!(event, RunEvent::Ready) {
            for window in app_handle.webview_windows().values() {
                win32::apply_window_chrome(window.as_ref());
            }
        }

        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            let state = app_handle.state::<BackendState>();
            // Take the handle out first so the mutex guard is dropped before
            // `kill` is called (and so a second exit event is a no-op).
            let child = state.child.lock().unwrap().take();
            if let Some(child) = child {
                if let Err(error) = child.kill() {
                    eprintln!("[backend] could not stop the sidecar: {error}");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{companion_labels, parse_ready_line};

    #[test]
    fn closing_the_original_window_keeps_other_copies() {
        let open = vec![
            "main".into(),
            "notes".into(),
            "viewer-note-a".into(),
            "app-b".into(),
            "notes-app-b".into(),
        ];
        assert_eq!(
            companion_labels("main", &open),
            vec!["notes".to_string(), "viewer-note-a".to_string()]
        );
    }

    #[test]
    fn closing_a_copy_closes_only_its_notes() {
        let open = vec![
            "main".into(),
            "notes".into(),
            "app-b".into(),
            "notes-app-b".into(),
            "viewer-note-a".into(),
        ];
        assert_eq!(
            companion_labels("app-b", &open),
            vec!["notes-app-b".to_string()]
        );
    }

    #[test]
    fn closing_a_reference_viewer_closes_nothing_else() {
        let open = vec!["main".into(), "viewer-note-a".into()];
        assert!(companion_labels("viewer-note-a", &open).is_empty());
    }

    #[test]
    fn reads_the_port() {
        assert_eq!(parse_ready_line("BACKEND_READY port=4317"), Some(4317));
        assert_eq!(parse_ready_line("  BACKEND_READY port=54321\r\n"), Some(54321));
    }

    #[test]
    fn ignores_everything_else() {
        for line in [
            "",
            "[backend] listening on http://127.0.0.1:4317",
            "BACKEND_READY",
            "BACKEND_READY port=",
            "BACKEND_READY port=abc",
            "BACKEND_READY port=0",
            "BACKEND_READY port=70000",
            "ready port=4317",
        ] {
            assert_eq!(parse_ready_line(line), None, "line: {line:?}");
        }
    }
}
