<#
.SYNOPSIS
    手动重启本机 Codex App Server（供 app-codexapp / phone tunnel 使用）。

.DESCRIPTION
    仅重启监听 127.0.0.1:4500 的 Codex App Server。
    不会停止 Relay(4501)、SSH 反向隧道或服务器上的 cloudflared。

    建议先在手机端断开连接，再运行本脚本。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File C:\file\app-codexapp\scripts\restart-phone-tunnel.ps1
#>

[CmdletBinding()]
param(
  [string]$ServerHost = "8.148.73.94",
  [string]$ServerUser = "admin",
  [string]$PublicUrl = "wss://codex.yinxingye.space",
  [int]$AppServerPort = 4500,
  [int]$RelayPort = 4501
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$StartScript = Join-Path $PSScriptRoot "start-phone-tunnel.ps1"
$NetstatCommand = Join-Path $env:SystemRoot "System32\netstat.exe"

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

$listenerPids = @(Get-AppServerListenerPids -Port $AppServerPort)
if ($listenerPids.Count -eq 0) {
  Write-Host "Codex App Server is not listening on 127.0.0.1:$AppServerPort; starting a fresh instance."
} else {
  foreach ($listenerPid in $listenerPids) {
    $process = Get-Process -Id $listenerPid -ErrorAction SilentlyContinue
    $processName = if ($process) { $process.ProcessName } else { "unknown" }
    Write-Host "Stopping the App Server listener (PID $listenerPid, process $processName)."
    Stop-Process -Id $listenerPid -Force -ErrorAction Stop
  }

  # 进程退出与端口释放不是同一时刻；先确认端口释放再让启动脚本创建新实例。
  Wait-ForPortState -Port $AppServerPort -ShouldBeListening $false
  Write-Host "Codex App Server port $AppServerPort has been released."
}

Write-Host "Starting the local phone tunnel services..."
& $StartScript -ServerHost $ServerHost -ServerUser $ServerUser -PublicUrl $PublicUrl -AppServerPort $AppServerPort -RelayPort $RelayPort -Once

Write-Host "Restart complete. Reconnect the phone app, then open the affected task again."
