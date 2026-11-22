#!/usr/bin/env bash
#
# One command, two processes, one lifetime: `yarn dev`.
#
#   backend/  `bun run dev`    prisma codegen, then `bun --watch src/main.ts`
#                              listening on http://127.0.0.1:4317
#   root      `npx tauri dev`   vite on :1420 + the Rust app (cargo watch)
#
# Both start together and die together. When either one exits — or when this
# script receives Ctrl-C (INT), SIGTERM, or SIGHUP because you closed the
# terminal window — both process trees are torn down, so you never leave a
# backend holding :4317 or a stray app window behind.
#
# Why process groups: `tauri dev` is really npx -> node -> { vite, cargo -> the
# .app }, and the backend is bun -> bun --watch. Killing just the pid we
# backgrounded would strand all of that. So with `set -m` each child becomes the
# leader of its own process group, and cleanup signals the whole group
# (`kill -- -<pgid>`) instead of a single pid.
#
# Extra arguments are forwarded to `tauri dev`, e.g. `yarn dev -- --no-watch`.
set -euo pipefail

cd "$(dirname "$0")"

BACKEND_PORT=4317 # matches backend/package.json's dev script
FRONTEND_PORT=1420 # matches build.devUrl in src-tauri/tauri.conf.json

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*"; }
fail() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

# --- preflight -------------------------------------------------------------
[ -d node_modules ] || fail "node_modules/ not found; run 'yarn install' first"
[ -d backend/node_modules ] || fail "backend/node_modules/ not found; run 'cd backend && bun install' first"
command -v bun >/dev/null 2>&1 || fail "bun is required to run the backend (https://bun.sh)"
command -v npx >/dev/null 2>&1 || fail "npx is required to run the Tauri CLI"

# A leftover process from an earlier run is the usual reason a fresh `yarn dev`
# appears to start nothing: the previous backend still holds :4317, or a previous
# vite still holds :1420, and the ports have to be free before either child can
# bind. Our own leftovers are reclaimed; a process from somewhere else is
# reported instead of killed.
#
# Kept pipe-free: a `lsof | head` pipeline trips `set -o pipefail` through the
# SIGPIPE that `head` causes on `lsof`.
port_pid() {
  local out
  out="$(lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null || true)"
  printf '%s' "${out%%$'\n'*}"
}

proc_cwd() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true
}

reclaim_port() {
  local port="$1" label="$2" pid cwd i=0

  command -v lsof >/dev/null 2>&1 || return 0

  pid="$(port_pid "$port")"
  [ -n "$pid" ] || return 0

  # The backend runs with cwd=backend/, so accept the whole subtree.
  cwd="$(proc_cwd "$pid")"
  case "$cwd" in
    "$PWD" | "$PWD"/*) ;;
    *)
      fail "port $port is held by pid $pid ($(ps -o comm= -p "$pid" 2>/dev/null)), which is not part of this project; free it with: lsof -nP -iTCP:$port -sTCP:LISTEN"
      ;;
  esac

  warn "$label from an earlier run is still on port $port (pid $pid); stopping it so this run can own the port"
  kill "$pid" 2>/dev/null || true
  while [ "$i" -lt 30 ] && [ -n "$(port_pid "$port")" ]; do
    sleep 0.1
    i=$((i + 1))
  done
  if [ -n "$(port_pid "$port")" ]; then
    kill -9 "$pid" 2>/dev/null || true
    sleep 0.2
  fi
  [ -z "$(port_pid "$port")" ] || fail "could not free port $port (still held by pid $(port_pid "$port"))"
}

reclaim_port "$BACKEND_PORT" "the backend"
reclaim_port "$FRONTEND_PORT" "vite"

# --- event-storming diagram -------------------------------------------------
# The diagram belongs to @machingclee/express-cqrs: it is built and published
# from that repository (`npm run build:event-storming` there), and this backend
# serves the copy that ships inside the package. Nothing to build here — the URL
# is reported so it is easy to open once the app is up.
diagram_url="http://127.0.0.1:$BACKEND_PORT/event-storming"

# --- teardown --------------------------------------------------------------
backend_pid=""
tauri_pid=""
cleaned=0

running() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# Signal every process in a child's group; fall back to the bare pid if the
# group lookup fails (it does not exist any more).
signal_group() {
  local pid="$1" sig="$2"
  [ -n "$pid" ] || return 0
  kill -s "$sig" -- "-$pid" 2>/dev/null || kill -s "$sig" "$pid" 2>/dev/null || true
}

# With job control on, bash announces every job it kills ("dev.sh: line N: 1234
# Terminated: 15 ..."), which reads like a failure. Mute stderr for exactly as
# long as we are signalling and reaping: the children's own shutdown lines land
# in there too, but we just asked them to die.
mute() { exec 3>&2; exec 2>/dev/null; }
unmute() { exec 2>&3 3>&-; }

# Kill both process trees and wait for them to go away.
terminate() {
  local i=0

  mute
  signal_group "$tauri_pid" TERM
  signal_group "$backend_pid" TERM
  # Give them a few seconds to shut down cleanly (the backend closes its
  # sqlite/prisma connection), then insist.
  while [ "$i" -lt 50 ]; do
    running "$tauri_pid" || running "$backend_pid" || break
    sleep 0.1
    i=$((i + 1))
  done
  unmute

  if running "$tauri_pid"; then
    warn "tauri dev ignored SIGTERM; killing it"
  fi
  if running "$backend_pid"; then
    warn "the backend ignored SIGTERM; killing it"
  fi
  if running "$tauri_pid" || running "$backend_pid"; then
    mute
    signal_group "$tauri_pid" KILL
    signal_group "$backend_pid" KILL
    sleep 0.2
    unmute
  fi
}

cleanup() {
  [ "$cleaned" -eq 0 ] || return 0
  cleaned=1
  trap - EXIT INT TERM HUP

  running "$tauri_pid" || running "$backend_pid" || return 0
  info "stopping the Tauri app and the backend"
  terminate

  if running "$tauri_pid" || running "$backend_pid"; then
    warn "a process survived; check with: lsof -nP -iTCP:$BACKEND_PORT -sTCP:LISTEN"
  else
    info "both stopped"
  fi
}

trap cleanup EXIT
trap 'exit 130' INT # Ctrl-C
trap 'exit 143' TERM
trap 'exit 129' HUP # terminal window closed

# --- run -------------------------------------------------------------------
# Turn on job control so every background job below gets its own process group.
set -m

info "starting the backend (bun --watch, http://127.0.0.1:$BACKEND_PORT)"
( cd backend && exec bun run dev ) </dev/null &
backend_pid=$!

info "starting the Tauri app (tauri dev, vite on http://localhost:$FRONTEND_PORT)"
npx tauri dev "$@" &
tauri_pid=$!

printf '\n'
info "both running — Ctrl-C or closing this terminal stops both"
if [ -n "$diagram_url" ]; then
  printf '    event-storming diagram: %s\n' "$diagram_url"
fi
printf '\n'

# Stay alive only while both are alive. macOS ships bash 3.2, which has no
# `wait -n`, so poll once a second instead.
while running "$tauri_pid" && running "$backend_pid"; do
  sleep 1
done

# Whichever exited first decides the exit status; the EXIT trap stops the other.
status=0
if ! running "$tauri_pid"; then
  wait "$tauri_pid" || status=$?
  info "tauri dev exited (status $status)"
elif ! running "$backend_pid"; then
  wait "$backend_pid" || status=$?
  info "the backend exited (status $status)"
fi

exit "$status"
