[CmdletBinding()]
param(
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$TaskName = "CodexMobilePhoneTunnelMonitor"
$MonitorScript = Join-Path $PSScriptRoot "start-phone-tunnel.ps1"
$PowerShellCommand = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$CurrentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed scheduled task $TaskName."
  return
}

if (-not (Test-Path -LiteralPath $MonitorScript)) {
  throw "Tunnel monitor script was not found: $MonitorScript"
}

$action = New-ScheduledTaskAction -Execute $PowerShellCommand -Argument (
  "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden " +
  "-ExecutionPolicy Bypass -File `"$MonitorScript`""
)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal `
  -UserId $CurrentUser `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Description "Starts and keeps the Codex Mobile reverse SSH tunnel monitor running at user logon." `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Force | Out-Null

# Replace the manually launched watcher so the scheduled task owns the long-lived process.
$pidFile = Join-Path $env:LOCALAPPDATA "CodexMobilePhoneTunnel\watcher.pid"
if (Test-Path -LiteralPath $pidFile) {
  $recordedPid = (Get-Content -LiteralPath $pidFile -Raw).Trim()
  if ($recordedPid -match '^\d+$') {
    $existing = Get-Process -Id ([int]$recordedPid) -ErrorAction SilentlyContinue
    if ($existing) {
      $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$recordedPid").CommandLine
      if ($commandLine -and $commandLine.Contains($MonitorScript)) {
        Stop-Process -Id ([int]$recordedPid) -Force
        Start-Sleep -Seconds 2
      }
    }
  }
}

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5
$task = Get-ScheduledTask -TaskName $TaskName
$taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName
if ($task.State -ne "Running") {
  throw "Scheduled task was registered but did not remain running. Last result: $($taskInfo.LastTaskResult)"
}

Write-Host "Installed and started scheduled task $TaskName for $CurrentUser."
Write-Host "It starts at every user logon and retries up to three times if the monitor exits with an error."
