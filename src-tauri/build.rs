fn main() {
    // tauri-codegen embeds these into the binary. Without this, swapping
    // icons does not trigger a rebuild, so `tauri dev` keeps the old Dock icon.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
