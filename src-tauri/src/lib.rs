use tauri_plugin_opener::OpenerExt;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![open_in_vscode])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
