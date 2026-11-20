#!/usr/bin/env bash
#
# Re-bundle the app with a freshly built frontend and the backend sidecar that
# is ALREADY in src-tauri/binaries/. The backend is not rebuilt, and neither are
# the Rust dependencies - only the app crate, which re-embeds dist/.
#
#   yarn bundle:frontend                  # .app + .dmg
#   yarn bundle:frontend --bundles app     # skip the dmg (faster)
#
# Extra arguments are forwarded to `tauri build`.
set -euo pipefail

cd "$(dirname "$0")"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*"; }
fail() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

# --- preflight -------------------------------------------------------------
[ -d node_modules ] || fail "node_modules/ not found; run 'yarn install' first"
command -v npx >/dev/null 2>&1 || fail "npx is required to run the Tauri CLI"

case "$(uname -m)" in
  arm64) sidecar_triple="aarch64-apple-darwin" ;;
  x86_64) sidecar_triple="x86_64-apple-darwin" ;;
  *) fail "unsupported CPU architecture: $(uname -m)" ;;
esac
sidecar="src-tauri/binaries/pdf-backend-${sidecar_triple}"

# The whole point of this script: reuse the backend binary that is already there.
[ -x "$sidecar" ] || fail "$sidecar is missing; run 'yarn bundle' once to compile the backend"
info "reusing the existing sidecar: ${sidecar} ($(du -h "$sidecar" | awk '{print $1}'), modified $(date -r "$sidecar" '+%Y-%m-%d %H:%M:%S'))"

# --- 1. frontend, Rust and the bundle --------------------------------------
# tauri.conf.json's beforeBuildCommand is just `npm run build`, so this builds
# the frontend (tsc + vite) and nothing else: the sidecar already on disk stays
# exactly as it is, which is the whole point of this script. No override needed.
info "bundling the app (frontend + Rust + bundle)"
npx tauri build "$@"

# --- 2. report what landed -------------------------------------------------
app_dir="src-tauri/target/release/bundle/macos"
dmg_dir="src-tauri/target/release/bundle/dmg"

info "artifacts"
found=0
for app in "$app_dir"/*.app; do
  [ -e "$app" ] || continue
  found=1
  printf '  %s (%s)\n' "$app" "$(du -sh "$app" | awk '{print $1}')"
  if [ -x "$app/Contents/MacOS/pdf-backend" ]; then
    printf '    embeds %s (%s, modified %s)\n' "Contents/MacOS/pdf-backend" \
      "$(du -h "$app/Contents/MacOS/pdf-backend" | awk '{print $1}')" \
      "$(date -r "$app/Contents/MacOS/pdf-backend" '+%Y-%m-%d %H:%M:%S')"
  else
    warn "no backend sidecar inside $app/Contents/MacOS"
  fi
done
for dmg in "$dmg_dir"/*.dmg; do
  [ -e "$dmg" ] || continue
  found=1
  printf '  %s (%s)\n' "$dmg" "$(du -h "$dmg" | awk '{print $1}')"
done
[ "$found" -eq 1 ] || warn "no bundle output found; pass a target such as --bundles app,dmg"
