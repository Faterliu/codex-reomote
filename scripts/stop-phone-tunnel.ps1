<#
.SYNOPSIS
    停止本机手机链路的监控器、App Server、Relay 和 SSH 反向隧道。

.DESCRIPTION
    只关闭本脚本组使用的本机进程。
#>

[CmdletBinding()]
param(
  [ValidateRange(1,65535)][int]$AppServerPort = 4500,
  [ValidateRange(1,65535)][int]$RelayPort = 4501
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RuntimeRoot = Join-Path $env:LOCALAPPDATA "CodexMobilePhoneTunnel"
$WatcherPidFile = Join-Path $RuntimeRoot "watcher.pid"
$WatcherTaskName = "CodexMobilePhoneTunnelMonitor"
$StartScriptPath = Join-Path $PSScriptRoot "start-phone-tunnel.ps1"
$NetstatCommand = Join-Path $env:SystemRoot "System32\netstat.exe"

function Get-ListenerPids {
  param([int]$Port)

  $expectedEndpoints = @("127.0.0.1:$Port", "[::1]:$Port")
  $pids = foreach ($line in (& $NetstatCommand -ano -p tcp)) {
    if ($line -match '^\s*TCP\s+(?<local>\S+)\s+\S+\s+LISTENING\s+(?<pid>\d+)\s*$' -and $expectedEndpoints -contains $Matches.local) {
      [int]$Matches.pid
    }
  }
  return @($pids | Sort-Object -Unique)
}

function Stop-LocalProcess {
  param([int]$ProcessId, [string]$Description)

  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    Write-Host "Stopped $Description (PID $ProcessId)."
  }
}

# 先关闭监控器，防止它在清理期间自动重新拉起服务。
if (Get-ScheduledTask -TaskName $WatcherTaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $WatcherTaskName -ErrorAction SilentlyContinue
  Write-Host "Stopped scheduled task $WatcherTaskName."
}

if (Test-Path -LiteralPath $WatcherPidFile) {
  $watcherText = (Get-Content -LiteralPath $WatcherPidFile -Raw -ErrorAction SilentlyContinue).Trim()
  if ($watcherText -match '^\d+$') {
    $watcherProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$watcherText" -ErrorAction SilentlyContinue
    if ($watcherProcess -and $watcherProcess.Name -in @("powershell.exe", "pwsh.exe") -and $watcherProcess.CommandLine -and $watcherProcess.CommandLine.Contains($StartScriptPath)) {
      Stop-LocalProcess -ProcessId ([int]$watcherText) -Description "phone tunnel watcher"
    }
  }
  Remove-Item -LiteralPath $WatcherPidFile -Force -ErrorAction SilentlyContinue
}

# 按脚本路径兜底查找监控器，处理 PID 文件过期或计划任务停止不及时的情况。
$legacyWatchers = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.ProcessId -ne $PID -and
    $_.Name -in @("powershell.exe", "pwsh.exe") -and
    $_.CommandLine -and
    $_.CommandLine.Contains($StartScriptPath) -and
    -not $_.CommandLine.Contains("-Once")
  }
foreach ($legacyWatcher in $legacyWatchers) {
  Stop-LocalProcess -ProcessId ([int]$legacyWatcher.ProcessId) -Description "phone tunnel watcher"
}

$servicePids = @(
  @(Get-ListenerPids -Port $AppServerPort)
  @(Get-ListenerPids -Port $RelayPort)
) | Sort-Object -Unique
foreach ($servicePid in $servicePids) {
  Stop-LocalProcess -ProcessId $servicePid -Description "phone tunnel local service"
}

# SSH 不监听本机端口，因此仅匹配本链路独有的 -R 参数。
$reversePattern = "127.0.0.1:$RelayPort`:127.0.0.1:$RelayPort"
$sshProcesses = Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($reversePattern) }
foreach ($sshProcess in $sshProcesses) {
  Stop-LocalProcess -ProcessId ([int]$sshProcess.ProcessId) -Description "SSH reverse tunnel"
}

Write-Host "Phone tunnel processes and monitor task have been stopped. Remote server processes were left untouched."
