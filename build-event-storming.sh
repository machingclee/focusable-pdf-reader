#!/usr/bin/env bash
#
# Build the event-storming diagram into the folder the backend serves.
#
#   yarn build:event-storming
#
# The diagram is the small Vite app in backend-event-storming/. Its build output
# goes straight into express-prisma-cqrs/src/event-storming/public (that project's vite
# `build.outDir`), where express-prisma-cqrs/src/event-storming/assets.ts mounts it at
# http://127.0.0.1:<port>/event-storming. It reads the graph from
# GET /docs/commands on the same origin, so a build never carries stale data.
#
# `yarn dev` calls this script first, so the URL is live as soon as the app
# starts. Run it again after changing the diagram's own UI.
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
cd "$root"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
fail() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

project="backend-event-storming"
out_dir="../express-prisma-cqrs/src/event-storming/public"

# --- preflight -------------------------------------------------------------
[ -d "$project" ] || fail "$project/ not found; run this from the project root"
command -v npm >/dev/null 2>&1 || fail "npm is required to build the diagram"

# --- dependencies ----------------------------------------------------------
# The diagram has its own package.json, so a fresh clone needs one install.
if [ ! -d "$project/node_modules" ]; then
  info "installing the diagram's dependencies (first run)"
  # The repo-local cache keeps npm off ~/.npm, whose _cacache is read-only on
  # machines where npm once ran as root (EPERM/EACCES would fail the install).
  ( cd "$project" && npm install --cache "$root/.npm-cache" --no-audit --no-fund )
fi

# --- build -----------------------------------------------------------------
info "building the diagram into $out_dir"
( cd "$project" && npm run build )

[ -f "$out_dir/index.html" ] || fail "the build produced no $out_dir/index.html"

asset_count=$(find "$out_dir/assets" -type f 2>/dev/null | wc -l | tr -d ' ')
size=$(du -sh "$out_dir" | awk '{print $1}')
# The backend imports the package from node_modules; keep its served copy in sync.
installed="backend/node_modules/express-prisma-cqrs/dist/event-storming/public"
if [ -d "$(dirname "$installed")" ]; then
  rm -rf "$installed"
  mkdir -p "$installed"
  cp -R "$out_dir/." "$installed/"
fi
info "diagram ready: $out_dir ($size, $asset_count asset file(s))"
info "served by the backend at /event-storming"
