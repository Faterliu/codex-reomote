[CmdletBinding()]
param(
  [string]$ServerHost = "8.148.73.94",
  [string]$ServerUser = "root",
  [int]$AppServerPort = 4500,
  [int]$RelayPort = 4501
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

function Test-TcpPort {
  param([int]$Port)

  return Test-NetConnection -ComputerName "127.0.0.1" -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue
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
    $response = & $SshCommand -F NUL -o BatchMode=yes -o ConnectTimeout=10 $RemoteTarget "curl --noproxy '*' --fail --silent --show-error --max-time 5 http://127.0.0.1:$RelayPort/readyz"
    return $LASTEXITCODE -eq 0 -and ($response -join "").Trim() -eq "ok"
  } catch {
    return $false
  }
}

function Get-RemoteQuickTunnelUrl {
  try {
    $url = & $SshCommand -F NUL -o BatchMode=yes -o ConnectTimeout=10 $RemoteTarget "grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' /tmp/codex-mobile-cloudflared.log 2>/dev/null | tail -n 1"
    if ($LASTEXITCODE -eq 0 -and $url) {
      return ($url | Select-Object -Last 1).Trim() -replace "^https://", "wss://"
    }
  } catch {
    return $null
  }

  return $null
}

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
  $tunnel = Start-Process -FilePath $SshCommand -ArgumentList @(
    "-F", "NUL",
    "-N",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-R", "127.0.0.1:$RelayPort`:127.0.0.1:$RelayPort",
    $RemoteTarget
  ) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogRoot "$RunId-reverse-tunnel.stdout.log") -RedirectStandardError (Join-Path $LogRoot "$RunId-reverse-tunnel.stderr.log") -PassThru
  $started.reverseTunnel = $tunnel.Id
  Wait-For -Condition { Invoke-RemoteReady } -Description "server-side Relay readiness through the SSH reverse tunnel" -TimeoutSeconds 20
  Write-Host "Started SSH reverse tunnel (PID $($tunnel.Id))."
} else {
  Write-Host "Server-side Relay is already healthy; reusing the existing reverse tunnel."
}

$publicUrl = Get-RemoteQuickTunnelUrl
$state = [ordered]@{
  startedAt = (Get-Date).ToString("o")
  server = $RemoteTarget
  appServerPort = $AppServerPort
  relayPort = $RelayPort
  publicUrl = $publicUrl
  started = $started
  logs = $LogRoot
}
$state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $RuntimeRoot "last-start.json") -Encoding utf8

Write-Host "Local phone tunnel is ready."
if ($publicUrl) {
  Write-Host "Mobile URL: $publicUrl"
}
Write-Host "Relay token remains in: $RelayTokenFile"
Write-Host "Logs: $LogRoot"
