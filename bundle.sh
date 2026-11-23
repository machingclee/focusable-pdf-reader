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
# Artifacts land in two different folders, which is easy to get wrong:
#   src-tauri/target/release/bundle/macos/*.app
#   src-tauri/target/release/bundle/dmg/*.dmg     <- the .dmg lives here
# The final step verifies both and fails the build if a requested dmg is
# missing, truncated or unreadable, because `tauri build` exits 0 even when its
# dmg step aborted.
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

# The diagram is a static build that ships inside the npm package, and
# tauri.conf.json's bundle.resources copies it out of there into the app bundle
# (the compiled sidecar cannot read node_modules at run time). Catch a missing
# package copy now, instead of after the Rust build with a bundler error.
diagram_dir="backend/node_modules/@machingclee/express-cqrs/dist/event-storming/public"
[ -f "$diagram_dir/index.html" ] ||
  fail "the event-storming diagram is missing from the installed package ($diagram_dir); run 'cd backend && bun install'"

# --- output locations and requested targets --------------------------------
product_name="PDF Focus Viewer"
app_dir="src-tauri/target/release/bundle/macos"
dmg_dir="src-tauri/target/release/bundle/dmg"

# `tauri build` with no --bundles falls back to bundle.targets in
# tauri.conf.json, which is "all" (app + dmg). `--bundles app` is the documented
# fast path that deliberately skips the dmg, so only insist on a dmg when one
# was actually asked for.
wants_dmg=1
bundles=""
i=0
while [ "$i" -lt "$#" ]; do
  i=$((i + 1))
  case "${!i}" in
    --bundles=*) bundles="${!i#*=}" ;;
    --bundles) i=$((i + 1)); bundles="${!i:-}" ;;
  esac
done
case ",${bundles}," in
  ,,|*,all,*|*,dmg,*) wants_dmg=1 ;;
  *) wants_dmg=0 ;;
esac

# --- clear debris from an aborted previous run -----------------------------
# This is the failure that costs the most time, because it looks like success:
# bundle_dmg.sh builds a temporary read-write image, mounts it, then converts it
# to the final .dmg and unmounts. If a previous run died before the unmount, the
# leftover volume is still holding that image, so the next run's detach fails,
# `set -e` aborts the script, and no .dmg is ever written -- while `tauri build`
# still exits 0. Clear both kinds of debris up front.
vol="/Volumes/${product_name}"
if [ -d "$vol" ]; then
  warn "'$vol' is still mounted from a previous run; detaching it"
  hdiutil detach "$vol" >/dev/null 2>&1 ||
    hdiutil detach "$vol" -force >/dev/null 2>&1 ||
    warn "could not detach '$vol'; eject it in Finder or the dmg step will fail"
fi

stale_rw=("$app_dir"/rw.*.dmg)
if [ -e "${stale_rw[0]}" ]; then
  warn "removing ${#stale_rw[@]} stale temporary disk image(s) from a previous run"
  rm -f "${stale_rw[@]}"
fi

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

# --- 3. verify what landed -------------------------------------------------
# Reporting is not enough: a missing or truncated dmg used to print a warning
# and still exit 0, so the only way to notice was to go looking for the file.
# Everything that was requested must now be present *and* mountable.
info "verifying artifacts"

apps=0
for app in "$app_dir"/*.app; do
  [ -e "$app" ] || continue
  apps=$((apps + 1))
  printf '  %s (%s)\n' "$app" "$(du -sh "$app" | awk '{print $1}')"
  [ -x "$app/Contents/MacOS/pdf-backend" ] ||
    fail "no backend sidecar inside $app/Contents/MacOS; the app would launch without its backend"
  printf '    embeds %s (%s)\n' "Contents/MacOS/pdf-backend" \
    "$(du -h "$app/Contents/MacOS/pdf-backend" | awk '{print $1}')"
done
[ "$apps" -gt 0 ] || fail "tauri build produced no .app in $app_dir"

# dmg files belong in $dmg_dir. Anything in the .app folder is debris, and its
# presence is the usual reason this output gets looked for in the wrong place.
for stray in "$app_dir"/*.dmg; do
  [ -e "$stray" ] || continue
  warn "ignoring $stray; dmg output belongs in $dmg_dir"
done

if [ "$wants_dmg" -eq 1 ]; then
  dmgs=0
  for dmg in "$dmg_dir"/*.dmg; do
    [ -e "$dmg" ] || continue
    size=$(stat -f%z "$dmg")
    # A failed `hdiutil convert` leaves the right name on a ~512-byte stub that
    # cannot be mounted. It is easy to find, copy somewhere, and only then
    # discover it is empty.
    [ "$size" -ge 1048576 ] ||
      fail "$dmg is only ${size} bytes, a truncated stub from a failed hdiutil convert; delete it and re-run"
    hdiutil verify "$dmg" >/dev/null 2>&1 ||
      fail "$dmg failed 'hdiutil verify'; delete it and re-run"
    dmgs=$((dmgs + 1))
    printf '  %s (%s, verified)\n' "$dmg" "$(du -h "$dmg" | awk '{print $1}')"
  done
  [ "$dmgs" -gt 0 ] ||
    fail "tauri build produced no .dmg in $dmg_dir. The dmg step aborts silently when a temporary image is still mounted, so check 'ls /Volumes' for a stale '$product_name' volume, then re-run"
fi
