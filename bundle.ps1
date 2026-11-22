# Build everything, from scratch, on Windows: the Bun backend sidecar, then the
# Tauri app with that sidecar embedded.
#
#   yarn bundle:win                      # NSIS setup + MSI
#   yarn bundle:win --bundles nsis       # skip the MSI (no WiX, faster)
#
# Extra arguments are forwarded to `tauri build`.
#
# Note: backend/package.json's build:windows already writes the compiled
# backend straight into src-tauri/binaries/pdf-backend-<triple>.exe, which is
# the file Tauri's bundle.externalBin picks up. So "copying it into src-tauri"
# is the build step itself; the check below makes sure it actually happened
# before we spend minutes on the Rust build.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Info([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Blue
}

function Warn([string]$Message) {
  Write-Host "warning: $Message" -ForegroundColor Yellow
}

function Fail([string]$Message) {
  Write-Host "error: $Message" -ForegroundColor Red
  exit 1
}

function Format-ByteSize([long]$Bytes) {
  if ($Bytes -ge 1GB) { return ('{0:0.0}G' -f ($Bytes / 1GB)) }
  if ($Bytes -ge 1MB) { return ('{0:0.0}M' -f ($Bytes / 1MB)) }
  if ($Bytes -ge 1KB) { return ('{0:0.0}K' -f ($Bytes / 1KB)) }
  return "$Bytes B"
}

function Format-FileSize([string]$Path) {
  $item = Get-Item -LiteralPath $Path
  Format-ByteSize $item.Length
}

# --- preflight -------------------------------------------------------------
if (-not (Test-Path -LiteralPath 'backend' -PathType Container)) {
  Fail "backend/ not found; run this from the project root"
}
if (-not (Test-Path -LiteralPath 'node_modules' -PathType Container)) {
  Fail "node_modules/ not found; run 'yarn install' first"
}
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Fail "bun is required to build the backend (https://bun.sh)"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "node is required to run the Tauri CLI"
}
# Dependencies may be installed with bun, which writes node_modules/.bin/tauri.exe
# and no npm shim. `npx tauri` then ignores that shim and fetches the unrelated
# registry package `tauri`, which has no executable. Call the local CLI directly.
$tauriJs = 'node_modules/@tauri-apps/cli/tauri.js'
if (-not (Test-Path -LiteralPath $tauriJs -PathType Leaf)) {
  Fail "the Tauri CLI is missing ($tauriJs); run 'yarn install' or 'bun install' in the project root"
}

$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
switch ($arch) {
  'X64' {
    $backendScript = 'build:windows'
    $sidecarTriple = 'x86_64-pc-windows-msvc'
  }
  default {
    Fail "unsupported CPU architecture: $arch (backend/package.json only builds an x64 Windows sidecar)"
  }
}
$sidecar = "src-tauri/binaries/pdf-backend-$sidecarTriple.exe"

# The diagram is a static build that ships inside the npm package, and
# tauri.conf.json's bundle.resources copies it out of there into the app bundle
# (the compiled sidecar cannot read node_modules at run time). Catch a missing
# package copy now, instead of after the Rust build with a bundler error.
$diagramDir = 'backend/node_modules/@machingclee/express-cqrs/dist/event-storming/public'
if (-not (Test-Path -LiteralPath (Join-Path $diagramDir 'index.html') -PathType Leaf)) {
  Fail "the event-storming diagram is missing from the installed package ($diagramDir); run 'cd backend; bun install'"
}

# --- 1. backend sidecar ----------------------------------------------------
Info "building the backend sidecar (bun run $backendScript in backend/)"
Push-Location backend
try {
  & bun run $backendScript
  if ($LASTEXITCODE -ne 0) {
    Fail "the backend build failed (exit $LASTEXITCODE)"
  }
} finally {
  Pop-Location
}
if (-not (Test-Path -LiteralPath $sidecar -PathType Leaf)) {
  Fail "the backend build did not produce an executable at $sidecar"
}
Info "sidecar ready: $sidecar ($(Format-FileSize $sidecar))"

# --- 2. frontend, Rust and the bundle --------------------------------------
# tauri.conf.json's beforeBuildCommand is only `npm run build`, so the sidecar is
# built exactly once, above. That ordering is deliberate: a backend failure stops
# us before the slow Rust build. It also means a bare `tauri build` (yarn
# build:exe) does NOT rebuild the backend; build through `yarn bundle:win` instead.
Info "building the app (frontend + Rust + bundle)"
& node $tauriJs build @args
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

# --- 3. report what landed -------------------------------------------------
# Tauri copies the sidecar next to the release exe as pdf-backend.exe, then
# packs that folder into the NSIS setup and the MSI.
$releaseSidecar = 'src-tauri/target/release/pdf-backend.exe'
$nsisDir = 'src-tauri/target/release/bundle/nsis'
$msiDir = 'src-tauri/target/release/bundle/msi'

Info 'artifacts'
$found = $false
if (Test-Path -LiteralPath $nsisDir -PathType Container) {
  Get-ChildItem -LiteralPath $nsisDir -Filter '*.exe' -File | ForEach-Object {
    $found = $true
    Write-Host ("  {0} ({1})" -f $_.FullName, (Format-ByteSize $_.Length))
  }
}
if (Test-Path -LiteralPath $msiDir -PathType Container) {
  Get-ChildItem -LiteralPath $msiDir -Filter '*.msi' -File | ForEach-Object {
    $found = $true
    Write-Host ("  {0} ({1})" -f $_.FullName, (Format-ByteSize $_.Length))
  }
}
if (Test-Path -LiteralPath $releaseSidecar -PathType Leaf) {
  Write-Host ("    embeds {0} ({1})" -f $releaseSidecar, (Format-FileSize $releaseSidecar))
} elseif ($found) {
  Warn "no backend sidecar at $releaseSidecar"
}
if (-not $found) {
  Warn "no bundle output found; pass a target such as --bundles nsis,msi"
}
