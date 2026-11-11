<#
    Runs the register as a background service on Windows.

    The problem this solves: START-ON-WINDOWS.bat runs the server inside
    your login session. Windows ends that session's processes when you log
    off, so the register stops the moment whoever started it disconnects.

    This registers a scheduled task instead. It starts at boot, runs as the
    SYSTEM account with nobody logged in, restarts itself if it stops, and
    writes to logs\server.log.

    Run it from an Administrator PowerShell, in the folder you unzipped:

        powershell -ExecutionPolicy Bypass -File service\install-windows.ps1

    To run under a domain service account instead of SYSTEM — which your
    policy may require — see the -UserId parameter below.
#>
[CmdletBinding()]
param(
  [string] $TaskName = 'Device register',
  [string] $UserId   = 'SYSTEM',
  [string] $Password = ''
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Write-Host "Register folder: $root"

if (-not (Test-Path (Join-Path $root 'src\server.mjs'))) {
  throw "src\server.mjs is not in $root. Run this from the folder you unzipped."
}
if (-not (Test-Path (Join-Path $root '.env'))) {
  throw "There is no .env in $root. Copy .env.example to .env and set ADMIN_PASSWORD, SESSION_SECRET and PUBLIC_URL first."
}

# Find node now and write the full path into the task's environment. The
# SYSTEM account often has a different PATH from yours, and "node is not
# recognised" at boot with no window to show it is a miserable thing to
# debug.
$node = (Get-Command node.exe -ErrorAction SilentlyContinue)
if (-not $node) { throw 'node.exe is not on PATH. Install Node.js 22.5 or newer, then run this again.' }
$nodeExe = $node.Source
Write-Host "Node: $nodeExe"

$wrapper = Join-Path $root 'service\run-windows.cmd'
$action  = New-ScheduledTaskAction -Execute $env:ComSpec `
  -Argument "/c set NODE_EXE=$nodeExe&& `"$wrapper`"" -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

if ($UserId -eq 'SYSTEM') {
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null
} else {
  # A named account needs its password once, to store the credential. The
  # account also needs "Log on as a batch job" and read/write on this folder.
  if (-not $Password) { throw "Pass -Password when using -UserId $UserId." }
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -User $UserId -Password $Password -RunLevel Highest -Force | Out-Null
}

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 6

$port = 3000
$envFile = Get-Content (Join-Path $root '.env')
$portLine = $envFile | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -First 1
if ($portLine) { $port = ($portLine -split '=', 2)[1].Trim() }

Write-Host ''
try {
  $health = Invoke-WebRequest -Uri "http://127.0.0.1:$port/healthz" -UseBasicParsing -TimeoutSec 10
  if ($health.Content.Trim() -eq 'ok') {
    Write-Host "Running. http://127.0.0.1:$port answers on /healthz." -ForegroundColor Green
  } else {
    Write-Warning "Answered, but not with 'ok'. Check logs\server.log."
  }
} catch {
  Write-Warning "Not answering on port $port yet. Give it a few seconds, then check logs\server.log."
}

Write-Host @"

Installed as the scheduled task: $TaskName

  It starts at boot and keeps running with nobody logged in.
  Log off, close the window, disconnect: it stays up.

  Check it      Get-ScheduledTask -TaskName '$TaskName'
  Stop it       Stop-ScheduledTask -TaskName '$TaskName'
  Start it      Start-ScheduledTask -TaskName '$TaskName'
  Watch the log Get-Content logs\server.log -Wait -Tail 20
  Remove it     powershell -ExecutionPolicy Bypass -File service\uninstall-windows.ps1

"@
