//! Tauri shell around the Bun backend.
//!
//! In a packaged build the backend runs as a sidecar: Rust starts it, reads the
//! `BACKEND_READY port=<n>` line it prints, and hands the address to the webview
//! through the `get_backend_info` command and the `backend-ready` event.
//! In development the backend is started separately (`npm run dev:backend`,
//! `bun --watch` on port 4317) and the frontend uses `VITE_BACKEND_PORT`, so
//! nothing is spawned here.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
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
            get_backend_info
        ])
        .setup(|app| {
            if tauri::is_dev() {
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
    use super::parse_ready_line;

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
