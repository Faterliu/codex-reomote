<#
.SYNOPSIS
    手动重启本机 Codex App Server（供 app-codexapp / phone tunnel 使用）。

.DESCRIPTION
    仅重启监听 127.0.0.1:4500 的 Codex App Server。
    不会停止 Relay(4501)、SSH 反向隧道或服务器上的 cloudflared。

    建议先在手机端断开连接，再运行本脚本。
    Relay 使用 -LocalOnly，仅重启本机 App Server，保留 Relay 并跳过旧链路检查。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File C:\file\app-codexapp\scripts\restart-phone-tunnel.ps1
.EXAMPLE
    .\scripts\restart-phone-tunnel.ps1 -LocalOnly
#>

[CmdletBinding()]
param(
  [string]$ServerHost = "8.148.73.94",
  [string]$ServerUser = "admin",
  [string]$PublicUrl = "wss://codex.yinxingye.space",
  [ValidateRange(1,65535)][int]$AppServerPort = 4500,
  [ValidateRange(1,65535)][int]$RelayPort = 4501,
  [switch]$LocalOnly,
  [string]$AppServerTokenFile = (Join-Path $env:USERPROFILE ".codex\app-server\mobile.token")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$StartScript = Join-Path $PSScriptRoot "start-phone-tunnel.ps1"
$NetstatCommand = Join-Path $env:SystemRoot "System32\netstat.exe"
$CodexCommand = Join-Path $env:APPDATA "npm\codex.cmd"
$RuntimeRoot = Join-Path $env:LOCALAPPDATA "CodexMobilePhoneTunnel"

# Relay 只重启上游，不检查旧 SSH/固定公网地址，也不重启承载 HTTP 请求的 Relay。
if ($LocalOnly) {
  foreach ($requiredPath in @($CodexCommand, $AppServerTokenFile)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) { throw "Required path is missing: $requiredPath" }
  }
  if ([string]::IsNullOrWhiteSpace((Get-Content -LiteralPath $AppServerTokenFile -Raw -Encoding utf8))) {
    throw 'App Server token file is empty; restart cancelled.'
  }
  if ($AppServerPort -eq $RelayPort) { throw 'App Server and Relay must use different ports.' }
}

foreach ($requiredPath in @($StartScript, $NetstatCommand)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required path is missing: $requiredPath"
  }
}

function Get-AppServerListenerPids {
  param([int]$Port)

  # 只匹配启动脚本约定的 loopback 监听器，避免误杀占用同端口的非本机服务。
  $expectedEndpoints = @("127.0.0.1:$Port", "[::1]:$Port")
  $pids = foreach ($line in (& $NetstatCommand -ano -p tcp)) {
    if ($line -match '^\s*TCP\s+(?<local>\S+)\s+\S+\s+LISTENING\s+(?<pid>\d+)\s*$' -and $expectedEndpoints -contains $Matches.local) {
      [int]$Matches.pid
    }
  }

  return @($pids | Sort-Object -Unique)
}

function Wait-ForPortState {
  param(
    [int]$Port,
    [bool]$ShouldBeListening,
    [int]$TimeoutSeconds = 15
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $listenerPids = @(Get-AppServerListenerPids -Port $Port)
    $isListening = $listenerPids.Count -gt 0
    if ($isListening -eq $ShouldBeListening) {
      return
    }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)

  $expectedState = if ($ShouldBeListening) { "start listening" } else { "be released" }
  throw "Timed out waiting for 127.0.0.1:$Port to $expectedState."
}

# 手动/手机重启与监控器恢复共用互斥锁，避免互相抢占端口。
$repairLock = New-Object System.Threading.Mutex($false, "Global\CodexPhoneRepair-$AppServerPort-$RelayPort")
$repairLocked = $false
try {
  try { $repairLocked = $repairLock.WaitOne([TimeSpan]::FromSeconds(30)) } catch [System.Threading.AbandonedMutexException] { $repairLocked = $true }
  if (-not $repairLocked) { throw 'Another repair is still running; restart cancelled.' }
$listenerPids = @(Get-AppServerListenerPids -Port $AppServerPort)
if ($listenerPids.Count -eq 0) {
  Write-Host "Codex App Server is not listening on 127.0.0.1:$AppServerPort; starting a fresh instance."
} else {
  foreach ($listenerPid in $listenerPids) {
    if ($LocalOnly) {
      $listener = Get-CimInstance Win32_Process -Filter "ProcessId=$listenerPid"
      if (-not $listener -or $listener.Name -ne 'codex.exe' -or $listener.CommandLine -notmatch '\bapp-server\b') {
        throw "Port $AppServerPort is occupied by another program; restart cancelled."
      }
    }
    $process = Get-Process -Id $listenerPid -ErrorAction SilentlyContinue
    $processName = if ($process) { $process.ProcessName } else { "unknown" }
    Write-Host "Stopping the App Server listener (PID $listenerPid, process $processName)."
    Stop-Process -Id $listenerPid -Force -ErrorAction Stop
  }

  # 进程退出与端口释放不是同一时刻；先确认端口释放再让启动脚本创建新实例。
  Wait-ForPortState -Port $AppServerPort -ShouldBeListening $false
  Write-Host "Codex App Server port $AppServerPort has been released."
}

if ($LocalOnly) {
  Write-Host "Starting the local App Server..."
  $LogRoot = Join-Path $RuntimeRoot 'logs'
  New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
  $RunId = (Get-Date -Format 'yyyyMMdd-HHmmss') + "-$PID-restart"
  Start-Process -FilePath $CodexCommand -ArgumentList @(
    'app-server', '--listen', "ws://127.0.0.1:$AppServerPort", '--ws-auth', 'capability-token',
    '--ws-token-file', ('"' + $AppServerTokenFile + '"')
  ) -WorkingDirectory (Split-Path -Parent $PSScriptRoot) -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $LogRoot "$RunId.stdout.log") `
    -RedirectStandardError (Join-Path $LogRoot "$RunId.stderr.log") | Out-Null
  Wait-ForPortState -Port $AppServerPort -ShouldBeListening $true
  $ready = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$AppServerPort/readyz" -TimeoutSec 5
  if ($ready.StatusCode -ne 200) { throw 'Restarted App Server is not ready.' }
} else {
  Write-Host "Starting the local phone tunnel services..."
  & $StartScript -ServerHost $ServerHost -ServerUser $ServerUser -PublicUrl $PublicUrl -AppServerPort $AppServerPort -RelayPort $RelayPort -Once
}

Write-Host "Restart complete. Reconnect the phone app, then open the affected task again."
} finally {
  if ($repairLocked) { $repairLock.ReleaseMutex() }
  $repairLock.Dispose()
}
