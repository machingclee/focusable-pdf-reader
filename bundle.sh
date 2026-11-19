#!/usr/bin/env bash
#
# Build everything, from scratch: the Bun backend sidecar, then the Tauri app
# with that sidecar embedded.
#
#   yarn bundle                  # .app + .dmg
#   yarn bundle --bundles app    # skip the dmg (faster)
#
# Extra arguments are forwarded to `tauri build`.
#
# Note: `backend/package.json`'s build:mac already writes the compiled backend
# straight into src-tauri/binaries/pdf-backend-<triple>, which is the file
# Tauri's `bundle.externalBin` picks up. So "copying it into src-tauri" is the
# build step itself; the check below makes sure it actually happened before we
# spend minutes on the Rust build.
set -euo pipefail

cd "$(dirname "$0")"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*"; }
fail() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

# --- preflight -------------------------------------------------------------
[ -d backend ] || fail "backend/ not found; run this from the project root"
[ -d node_modules ] || fail "node_modules/ not found; run 'yarn install' first"
command -v bun >/dev/null 2>&1 || fail "bun is required to build the backend (https://bun.sh)"
command -v npx >/dev/null 2>&1 || fail "npx is required to run the Tauri CLI"

case "$(uname -m)" in
  arm64) backend_script="build:mac" sidecar_triple="aarch64-apple-darwin" ;;
  x86_64) backend_script="build:mac-x64" sidecar_triple="x86_64-apple-darwin" ;;
  *) fail "unsupported CPU architecture: $(uname -m)" ;;
esac
sidecar="src-tauri/binaries/pdf-backend-${sidecar_triple}"

# --- 1. backend sidecar ----------------------------------------------------
info "building the backend sidecar (bun run ${backend_script} in backend/)"
(cd backend && bun run "$backend_script")
[ -x "$sidecar" ] || fail "the backend build did not produce an executable at $sidecar"
info "sidecar ready: ${sidecar} ($(du -h "$sidecar" | awk '{print $1}'))"

# --- 2. frontend, Rust and the bundle --------------------------------------
# tauri.conf.json's beforeBuildCommand is only `npm run build`, so the sidecar is
# built exactly once, above. That ordering is deliberate: a backend failure stops
# us before the slow Rust build. It also means a bare `tauri build` (yarn
# build:exe) does NOT rebuild the backend; build through `yarn bundle` instead.
info "building the app (frontend + Rust + bundle)"
npx tauri build "$@"

# --- 3. report what landed -------------------------------------------------
app_dir="src-tauri/target/release/bundle/macos"
dmg_dir="src-tauri/target/release/bundle/dmg"

info "artifacts"
found=0
for app in "$app_dir"/*.app; do
  [ -e "$app" ] || continue
  found=1
  printf '  %s (%s)\n' "$app" "$(du -sh "$app" | awk '{print $1}')"
  if [ -x "$app/Contents/MacOS/pdf-backend" ]; then
    printf '    embeds %s (%s)\n' "Contents/MacOS/pdf-backend" "$(du -h "$app/Contents/MacOS/pdf-backend" | awk '{print $1}')"
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
