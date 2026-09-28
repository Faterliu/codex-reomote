[CmdletBinding()]
param(
  [string]$ServerHost = "8.148.73.94",
  [string]$ServerUser = "admin",
  [string]$PublicUrl = "wss://codex.yinxingye.space",
  [ValidateRange(1,65535)][int]$AppServerPort = 4500,
  [ValidateRange(1,65535)][int]$RelayPort = 4501,
  [switch]$Once,
  [ValidateRange(10,3600)][int]$CheckIntervalSeconds = 60
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$TokenRoot = Join-Path $env:USERPROFILE ".codex\app-server"
$MobileTokenFile = Join-Path $TokenRoot "mobile.token"
$RelayTokenFile = Join-Path $TokenRoot "relay.token"
$CodexCommand = Join-Path $env:APPDATA "npm\codex.cmd"
$NodeCommand = (Get-Command node -ErrorAction Stop).Source
$SshCommand = Join-Path $env:SystemRoot "System32\OpenSSH\ssh.exe"
$RuntimeRoot = Join-Path $env:LOCALAPPDATA "CodexMobilePhoneTunnel"
$LogRoot = Join-Path $RuntimeRoot "logs"
$WatcherLogFile = Join-Path $LogRoot "watcher.log"
$WatcherPidFile = Join-Path $RuntimeRoot "watcher.pid"
$RunId = Get-Date -Format "yyyyMMdd-HHmmss"
$RemoteTarget = "$ServerUser@$ServerHost"

foreach ($requiredPath in @(
  $ProjectRoot,
  $MobileTokenFile,
  $RelayTokenFile,
  $CodexCommand,
  $NodeCommand,
  $SshCommand,
  (Join-Path $ProjectRoot "scripts\app-server-relay.mjs")
)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required path is missing: $requiredPath"
  }
}

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

function Write-WatcherLog {
  param([string]$Message)

  Add-Content -LiteralPath $WatcherLogFile -Value "$(Get-Date -Format o) $Message" -Encoding utf8
}

function Test-TcpPort {
  param([int]$Port)

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $attempt = $client.ConnectAsync('127.0.0.1', $Port)
    return $attempt.Wait(2000) -and $client.Connected
  } catch { return $false } finally { $client.Dispose() }
}

function Test-RelayReady {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 -Uri "http://127.0.0.1:$RelayPort/readyz"
    return $response.StatusCode -eq 200 -and $response.Content.Trim() -eq "ok"
  } catch {
    return $false
  }
}

function Wait-For {
  param(
    [scriptblock]$Condition,
    [string]$Description,
    [int]$TimeoutSeconds = 15
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (& $Condition) {
      return
    }
    Start-Sleep -Milliseconds 400
  } while ((Get-Date) -lt $deadline)

  throw "Timed out waiting for $Description."
}

function Invoke-RemoteReady {
  try {
    $response = & $SshCommand -F NUL -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -o ConnectionAttempts=1 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 $RemoteTarget "curl --noproxy '*' --fail --silent --show-error --max-time 5 http://127.0.0.1:$RelayPort/readyz" 2>$null
    return $LASTEXITCODE -eq 0 -and ($response -join "").Trim() -eq "ok"
  } catch {
    return $false
  }
}

function Test-PublicWebSocket {
  param([string]$TargetUrl)

  try {
    $parsedUrl = [Uri]$TargetUrl
    if (-not $parsedUrl.IsAbsoluteUri -or $parsedUrl.Scheme -ne "wss") { return $false }
  } catch {
    return $false
  }

  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  $timeout = [System.Threading.CancellationTokenSource]::new()
  try {
    $relayToken = (Get-Content -LiteralPath $RelayTokenFile -Raw).Trim()
    $separator = if ($TargetUrl.Contains('?')) { '&' } else { '?' }
    $uri = [Uri]("$TargetUrl${separator}relay_token=$([Uri]::EscapeDataString($relayToken))")
    $timeout.CancelAfter(10000)
    $socket.ConnectAsync($uri, $timeout.Token).GetAwaiter().GetResult()
    return $socket.State -eq [System.Net.WebSockets.WebSocketState]::Open
  } catch {
    return $false
  } finally {
    $socket.Abort()
    $socket.Dispose()
    $timeout.Dispose()
  }
}

function Invoke-PhoneRepair {
  $repairLock = New-Object System.Threading.Mutex($false, "Global\CodexPhoneRepair-$AppServerPort-$RelayPort")
  $locked = $false
  try {
    try { $locked = $repairLock.WaitOne([TimeSpan]::Zero) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { Write-Host 'Another repair is running; skipping.'; return }
    $RunId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$started = [ordered]@{
  appServer = $null
  relay = $null
  reverseTunnel = $null
}

if (-not (Test-TcpPort -Port $AppServerPort)) {
  $appServer = Start-Process -FilePath $CodexCommand -ArgumentList @(
    "app-server",
    "--listen", "ws://127.0.0.1:$AppServerPort",
    "--ws-auth", "capability-token",
    "--ws-token-file", $MobileTokenFile
  ) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogRoot "$RunId-app-server.stdout.log") -RedirectStandardError (Join-Path $LogRoot "$RunId-app-server.stderr.log") -PassThru
  $started.appServer = $appServer.Id
  Wait-For -Condition { Test-TcpPort -Port $AppServerPort } -Description "Codex App Server on 127.0.0.1:$AppServerPort"
  Write-Host "Started Codex App Server (PID $($appServer.Id))."
} else {
  Write-Host "Codex App Server port $AppServerPort is already listening; reusing it."
}

if (-not (Test-RelayReady)) {
  if (Test-TcpPort -Port $RelayPort) {
    throw "127.0.0.1:$RelayPort is occupied but does not pass the Relay readiness check. Resolve that conflict before continuing."
  }

  $env:RELAY_LISTEN_HOST = "127.0.0.1"
  $env:RELAY_LISTEN_PORT = "$RelayPort"
  $env:RELAY_TOKEN = (Get-Content -LiteralPath $RelayTokenFile -Raw).Trim()
  $env:UPSTREAM_WS_URL = "ws://127.0.0.1:$AppServerPort"
  $env:UPSTREAM_TOKEN_FILE = $MobileTokenFile

  if ($env:RELAY_TOKEN.Length -lt 20) {
    throw "Relay token is unexpectedly short."
  }

  $relay = Start-Process -FilePath $NodeCommand -ArgumentList @((Join-Path $ProjectRoot "scripts\app-server-relay.mjs")) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogRoot "$RunId-relay.stdout.log") -RedirectStandardError (Join-Path $LogRoot "$RunId-relay.stderr.log") -PassThru
  $started.relay = $relay.Id
  Wait-For -Condition { Test-RelayReady } -Description "Relay readiness endpoint"
  Write-Host "Started Relay (PID $($relay.Id))."
} else {
  Write-Host "Relay on 127.0.0.1:$RelayPort is already healthy; reusing it."
}

if (-not (Invoke-RemoteReady)) {
  # Check SSH connectivity and remote port ownership before creating a tunnel.
  $remoteCheck = & $SshCommand -F NUL -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -o ConnectionAttempts=1 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 $RemoteTarget "ss -ltnH 'sport = :$RelayPort'" 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'SSH unavailable; retry after the network recovers.' }
  if ($remoteCheck) { throw 'Remote relay port is still occupied; waiting for the old connection to expire.' }
  $tunnel = Start-Process -FilePath $SshCommand -ArgumentList @(
    "-F", "NUL",
    "-N",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ConnectionAttempts=1",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-R", "127.0.0.1:$RelayPort`:127.0.0.1:$RelayPort",
    $RemoteTarget
  ) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogRoot "$RunId-reverse-tunnel.stdout.log") -RedirectStandardError (Join-Path $LogRoot "$RunId-reverse-tunnel.stderr.log") -PassThru
  $started.reverseTunnel = $tunnel.Id
  try {
    Wait-For -Condition { Invoke-RemoteReady } -Description "server-side Relay readiness through the SSH reverse tunnel" -TimeoutSeconds 20
  } catch {
    # Only clean up the process created by this attempt, never an unrelated SSH.
    $tunnel.Refresh()
    if (-not $tunnel.HasExited) { $tunnel.Kill(); $tunnel.WaitForExit(5000) | Out-Null }
    throw
  }
  Write-Host "Started SSH reverse tunnel (PID $($tunnel.Id))."
} else {
  Write-Host "Server-side Relay is already healthy; reusing the existing reverse tunnel."
}

if (-not (Test-PublicWebSocket -TargetUrl $PublicUrl)) {
  throw "Public WebSocket health check failed for $PublicUrl. Check the HTTPS reverse proxy, SSH reverse tunnel, Relay, and relay token."
}
$state = [ordered]@{
  startedAt = (Get-Date).ToString("o")
  server = $RemoteTarget
  appServerPort = $AppServerPort
  relayPort = $RelayPort
  publicUrl = $PublicUrl
  started = $started
  logs = $LogRoot
}
$state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $RuntimeRoot "last-start.json") -Encoding utf8

Write-Host "Local phone tunnel is ready."
Write-Host "Mobile URL: $PublicUrl"
Write-Host "Relay token remains in: $RelayTokenFile"
Write-Host "Logs: $LogRoot"
  } finally {
    if ($locked) { $repairLock.ReleaseMutex() }
    $repairLock.Dispose()
  }
}

if ($Once) { Invoke-PhoneRepair; return }

# A single foreground watcher survives transient network errors. Ctrl+C stops it.
$watchLock = New-Object System.Threading.Mutex($false, "Global\CodexPhoneWatch-$AppServerPort-$RelayPort")
$watchLocked = $false
try {
  Write-WatcherLog "Watcher process $PID starting."
  try { $watchLocked = $watchLock.WaitOne([TimeSpan]::Zero) } catch [System.Threading.AbandonedMutexException] { $watchLocked = $true }
  if (-not $watchLocked) {
    Write-WatcherLog "Watcher process $PID found another active watcher and is exiting."
    Write-Host 'Phone tunnel watcher is already running.'
    return
  }
  $PID | Set-Content -LiteralPath $WatcherPidFile -Encoding ascii
  Write-WatcherLog "Watcher process $PID acquired its lock and wrote its PID file."
  try { Invoke-PhoneRepair } catch { Write-Warning $_.Exception.Message }
  Write-Host "Watching every $CheckIntervalSeconds seconds. Keep this process running; Ctrl+C stops monitoring."
  $failures = 0
  while ($true) {
    Start-Sleep -Seconds $CheckIntervalSeconds
    if ((Test-TcpPort -Port $AppServerPort) -and (Test-RelayReady) -and (Invoke-RemoteReady) -and (Test-PublicWebSocket -TargetUrl $PublicUrl)) {
      if ($failures -gt 0) {
        Write-WatcherLog "Connection recovered after $failures failed health checks."
        Write-Host "$(Get-Date -Format s) Connection recovered."
      }
      $failures = 0
      continue
    }
    $failures++
    Write-WatcherLog "Health check failed ($failures/2)."
    Write-Warning "$(Get-Date -Format s) Health check failed ($failures/2)."
    if ($failures -ge 2) {
      try {
        Invoke-PhoneRepair
      } catch {
        Write-WatcherLog "Automatic repair failed: $($_.Exception.Message)"
        Write-Warning $_.Exception.Message
      }
      $failures = 0
    }
  }
} catch {
  Write-WatcherLog "Watcher process $PID stopped on error: $($_.Exception.Message)"
  throw
} finally {
  if (Test-Path -LiteralPath $WatcherPidFile) {
    $recordedPid = (Get-Content -LiteralPath $WatcherPidFile -Raw -ErrorAction SilentlyContinue).Trim()
    if ($recordedPid -eq "$PID") { Remove-Item -LiteralPath $WatcherPidFile -Force -ErrorAction SilentlyContinue }
  }
  if ($watchLocked) { $watchLock.ReleaseMutex() }
  $watchLock.Dispose()
}
