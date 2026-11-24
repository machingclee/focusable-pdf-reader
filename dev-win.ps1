# One command, two processes, one lifetime, on Windows: `bun dev:win`.
#
# The `dev` script is bash (dev.sh) and is macOS/Linux only: it finds leftover
# listeners with lsof and tears down process trees with POSIX process groups.
# Neither exists on Windows, so this script keeps the same contract with the
# tools that do:
#
#   backend/  `bun run dev`              prisma codegen, then `bun --watch src/main.ts`
#                                        listening on http://127.0.0.1:4317
#   root      `node .../tauri.js dev`    vite on :1420 + the Rust app (cargo watch)
#
# Both start together and die together. The two children are put into a Windows
# Job Object configured with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: when this
# PowerShell process ends -- normally, on Ctrl-C, or because the terminal window
# was closed -- Windows closes the job handle and the kernel terminates every
# process still in the job. That is the Windows analogue of dev.sh's process
# groups, and unlike `taskkill /T` it still reaches processes that have already
# outlived their parent (cargo can exit before the app window does).
#
# Extra arguments are forwarded to `tauri dev`, e.g. `bun run dev:win -- --no-watch`.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$root = $PSScriptRoot

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

# taskkill reports "could not be terminated" on stderr for a process that
# ignores the polite request or is already gone, and with
# $ErrorActionPreference = 'Stop' a redirected native command's stderr becomes a
# terminating NativeCommandError. Run it through Start-Process instead: it
# inherits no streams, so a failed stop can never abort the teardown.
function Invoke-Taskkill([int]$ProcessId, [switch]$Force) {
  $arguments = @('/PID', "$ProcessId", '/T')
  if ($Force) { $arguments += '/F' }
  Start-Process -FilePath "$env:SystemRoot\System32\taskkill.exe" -ArgumentList $arguments -Wait -WindowStyle Hidden
}

# --- job object (the teardown guarantee) -----------------------------------
# A job object is the kernel's notion of "this group of processes dies together".
# KILL_ON_JOB_CLOSE means the group dies when its last handle is closed, which
# happens automatically if this process is killed and never gets to run its
# cleanup.
if (-not ('DevJob' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class DevJob
{
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;

    [StructLayout(LayoutKind.Sequential)]
    public struct IoCounters
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct BasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ExtendedLimitInformation
    {
        public BasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr hJob, int jobObjectInformationClass, IntPtr lpJobObjectInformation, uint cbJobObjectInformationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    public static IntPtr CreateKillOnClose()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject failed");
        }

        var info = new ExtendedLimitInformation();
        info.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;

        int size = Marshal.SizeOf(typeof(ExtendedLimitInformation));
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, buffer, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, (uint)size))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "SetInformationJobObject failed");
            }
        }
        catch
        {
            CloseHandle(job);
            throw;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }

        return job;
    }

    public static void Assign(IntPtr job, IntPtr process)
    {
        if (!AssignProcessToJobObject(job, process))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "AssignProcessToJobObject failed");
        }
    }

    public static void Close(IntPtr job)
    {
        if (job != IntPtr.Zero)
        {
            CloseHandle(job);
        }
    }
}
'@
}

function Add-ToJob([System.Diagnostics.Process]$Process) {
  if ($job -eq $null -or $job -eq [IntPtr]::Zero) { return }
  try {
    [DevJob]::Assign($job, $Process.Handle)
  } catch {
    # Normally nested jobs are fine on Windows 8+, but a host that already put
    # this process in a restricted job can refuse. Cleanup still runs, it just
    # falls back to `taskkill /T` and can miss an orphaned app window.
    Warn "could not put $($Process.ProcessName) (pid $($Process.Id)) in the job object: $($_.Exception.Message)"
  }
}

# --- preflight -------------------------------------------------------------
$backendPort = 4317 # matches backend/package.json's dev script
$frontendPort = 1420 # matches build.devUrl in src-tauri/tauri.conf.json

if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules') -PathType Container)) {
  Fail "node_modules/ not found; run 'bun install' first"
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'backend\node_modules') -PathType Container)) {
  Fail "backend/node_modules/ not found; run 'bun install' in backend/ first"
}

$bun = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bun) {
  Fail "bun is required to run the backend (https://bun.sh)"
}
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Fail "node is required to run the Tauri CLI"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Warn "npm was not found; tauri.conf.json's beforeDevCommand is 'npm run dev:web', so tauri dev may fail to start vite"
}

# Dependencies may be installed with bun, which writes node_modules/.bin/tauri.exe
# and no npm shim. `npx tauri` then ignores that shim and fetches the unrelated
# registry package `tauri`, which has no executable. Call the local CLI directly.
$tauriJs = Join-Path $root 'node_modules\@tauri-apps\cli\tauri.js'
if (-not (Test-Path -LiteralPath $tauriJs -PathType Leaf)) {
  Fail "the Tauri CLI is missing ($tauriJs); run 'bun install' in the project root"
}

# --- leftover listeners ----------------------------------------------------
# A leftover process from an earlier run is the usual reason a fresh `dev:win`
# appears to start nothing: the previous backend still holds :4317, or a
# previous vite still holds :1420, and the ports have to be free before either
# child can bind. Our own leftovers are reclaimed; a process from somewhere else
# is reported instead of killed.
$hasNetTcpConnection = [bool](Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)

function Get-PortOwner([int]$Port) {
  if ($hasNetTcpConnection) {
    try {
      $connection = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)
      if ($connection.Count -gt 0) { return [int]$connection[0].OwningProcess }
      return 0
    } catch {
      # Fall through to netstat if the cmdlet is present but unusable.
    }
  }

  # No -p TCP: that filters out TCPv6, and vite may well bind only IPv6.
  foreach ($line in (& netstat.exe -ano)) {
    if ($line -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$") {
      return [int]$matches[1]
    }
  }
  return 0
}

function Get-ProcessInfo([int]$ProcessId) {
  try {
    return Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
  } catch {
    return $null
  }
}

function Test-OwnsWorkspace($Info) {
  if ($null -eq $Info) { return $false }

  $commandLine = [string]$Info.CommandLine
  if ($commandLine -and $commandLine.IndexOf($root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
    return $true
  }

  # `bun --watch src/main.ts` and vite are started from this project but their
  # command lines are relative, so the cwd (which Win32_Process cannot report)
  # has to be inferred from what they are running.
  return [bool]($commandLine -match '(?i)(src[\\/]main\.ts|tauri\.js|node_modules[\\/](vite|@tauri-apps)[\\/]|\\vite\.js)')
}

function Clear-Port([int]$Port, [string]$Label) {
  $owner = Get-PortOwner $Port
  if ($owner -eq 0) { return }

  $info = Get-ProcessInfo $owner
  $ownerName = if ($null -ne $info -and $info.Name) { $info.Name } else { "pid $owner" }

  if (-not (Test-OwnsWorkspace $info)) {
    Fail "port $Port is held by pid $owner ($ownerName), which does not look like part of this project; stop it first (Stop-Process -Id $owner -Force) or free the port with: netstat -ano -p TCP | findstr :$Port"
  }

  Warn "$Label from an earlier run is still on port $Port (pid $owner); stopping it so this run can own the port"
  Invoke-Taskkill -ProcessId $owner -Force

  for ($i = 0; $i -lt 50 -and (Get-PortOwner $Port) -ne 0; $i++) {
    Start-Sleep -Milliseconds 100
  }
  if ((Get-PortOwner $Port) -ne 0) {
    Fail "could not free port $Port (still held by pid $(Get-PortOwner $Port))"
  }
}

Clear-Port $backendPort 'the backend'
Clear-Port $frontendPort 'vite'

# --- build outside the checkout ---------------------------------------------
# While the built app lives under this repository, its WebView2 browser process
# dies on startup (`msedge_elf.dll`, exception 0x80000003) and the window is torn
# down as soon as it appears -- reproducibly, 6 runs out of 6. The same binary
# copied anywhere outside the checkout runs 6 out of 6. The app's own frame code,
# the frontend, the WebView2 profile and the runtime are all ruled out (the same
# build runs fine from `%LOCALAPPDATA%`), and nothing in the source differs
# between the two locations; only the directory the executable is started from
# does. Until that is understood the build is pointed outside the repository, so
# `bun dev:win` runs the app from a path that works.
#
# `src-tauri\target` can be deleted once this is gone; cargo rebuilds in about a
# minute. See the notes in the commit that added this if it is ever safe to drop.
$env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA 'tauri-pdf-focus-viewer\cargo-target'
New-Item -ItemType Directory -Force -Path $env:CARGO_TARGET_DIR | Out-Null

# --- run -------------------------------------------------------------------
# The diagram belongs to @machingclee/express-cqrs: it is built and published
# from that repository (`npm run build:event-storming` there), and this backend
# serves the copy that ships inside the package. Nothing to build here -- the URL
# is reported so it is easy to open once the app is up.
$diagramUrl = "http://127.0.0.1:$backendPort/event-storming"

function Test-Running($Process) {
  if ($null -eq $Process) { return $false }
  return -not $Process.HasExited
}

$job = $null
try {
  $job = [DevJob]::CreateKillOnClose()
} catch {
  Warn "could not create the job object ($($_.Exception.Message)); falling back to taskkill process trees, which cannot always stop an orphaned app window"
}

$backend = $null
$tauri = $null
$status = 0

# Start-Process -NoNewWindow keeps both children on this console: their output
# interleaves here as it does in dev.sh, and Ctrl-C reaches them directly.
try {
  Info "starting the backend (bun --watch, http://127.0.0.1:$backendPort)"
  $backend = Start-Process -FilePath $bun.Source -ArgumentList @('run', 'dev') `
    -WorkingDirectory (Join-Path $root 'backend') -NoNewWindow -PassThru
  Add-ToJob $backend

  # Quote forwarded arguments that contain spaces for the child's command line.
  $tauriCommand = @($tauriJs, 'dev') + @($args)
  $tauriArguments = ($tauriCommand | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '

  Info "starting the Tauri app (tauri dev, vite on http://localhost:$frontendPort)"
  $tauri = Start-Process -FilePath $node.Source -ArgumentList $tauriArguments `
    -WorkingDirectory $root -NoNewWindow -PassThru
  Add-ToJob $tauri

  Write-Host ''
  Info 'both running - Ctrl-C or closing this terminal stops both'
  Write-Host "    event-storming diagram: $diagramUrl"
  Write-Host ''

  # Stay alive only while both are alive. Whichever exits first decides the
  # exit status; the finally block stops the other.
  while ((Test-Running $tauri) -and (Test-Running $backend)) {
    Start-Sleep -Milliseconds 400
  }

  if (-not (Test-Running $tauri)) {
    $status = $tauri.ExitCode
    Info "tauri dev exited (status $status)"
  } elseif (-not (Test-Running $backend)) {
    $status = $backend.ExitCode
    Info "the backend exited (status $status)"
  }
} finally {
  $alive = @()
  if (Test-Running $backend) { $alive += $backend }
  if (Test-Running $tauri) { $alive += $tauri }

  if ($alive.Count -gt 0) {
    Info 'stopping the Tauri app and the backend'

    # Give the app window a chance to close the way the user closing it would:
    # `taskkill /T` without /F posts WM_CLOSE, so Tauri runs its close handler.
    # Console children (bun, vite) cannot honour it -- Windows has no SIGTERM --
    # and are killed by the job object below instead.
    if (Test-Running $tauri) {
      Invoke-Taskkill -ProcessId $tauri.Id
      $deadline = (Get-Date).AddSeconds(3)
      while ((Get-Date) -lt $deadline -and (Test-Running $tauri)) {
        Start-Sleep -Milliseconds 200
      }
    }

    # Closing the job handle terminates every process still in the job. This is
    # the step that does the real work; the polite request above is only a
    # chance for the app to save and exit on its own terms.
    if ($job -ne $null -and $job -ne [IntPtr]::Zero) {
      [DevJob]::Close($job)
      $job = $null
    }

    # Anything the job could not cover (it was unavailable, or a child broke
    # away from it) is killed with its process tree.
    foreach ($process in $alive) {
      if (Test-Running $process) {
        Invoke-Taskkill -ProcessId $process.Id -Force
      }
    }
    Start-Sleep -Milliseconds 300

    if (@($alive | Where-Object { Test-Running $_ }).Count -gt 0) {
      Warn "a process survived; check with: netstat -ano -p TCP | findstr :$backendPort"
    } else {
      Info 'both stopped'
    }
  }

  if ($job -ne $null -and $job -ne [IntPtr]::Zero) {
    [DevJob]::Close($job)
  }
}

exit $status
