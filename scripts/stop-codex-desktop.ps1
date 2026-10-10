#requires -Version 5.1
<#
.SYNOPSIS
    退出 Codex/ChatGPT 桌面端，保留手机 App Server 和 Relay。
.EXAMPLE
    .\scripts\stop-codex-desktop.ps1 -WhatIf
.EXAMPLE
    .\scripts\stop-codex-desktop.ps1
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateRange(1,65535)][int]$AppServerPort = 4500,
    [ValidateRange(1,65535)][int]$RelayPort = 4501
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$desktopPattern = '(?i)\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\(?:ChatGPT|Codex|resources\\codex|resources\\codex-code-mode-host)\.exe$'

$snapshot = @(& { $WhatIfPreference = $false; Get-CimInstance Win32_Process })
$protected = New-Object 'System.Collections.Generic.HashSet[int]'
$null = $protected.Add($PID)

# 保护手机服务、其子进程与启动器；同名 codex.exe 不能作为结束依据。
$netstat = Join-Path $env:SystemRoot 'System32\netstat.exe'
foreach ($line in (& $netstat -ano -p tcp)) {
    if ($line -match '^\s*TCP\s+(?<local>\S+)\s+\S+\s+LISTENING\s+(?<pid>\d+)\s*$') {
        $endpoint = $Matches.local
        $listenerProcessId = [int]$Matches.pid
        if ($endpoint -match ":($AppServerPort|$RelayPort)$") {
            $null = $protected.Add($listenerProcessId)
        }
    }
}
if ($LASTEXITCODE -ne 0) { throw '无法检查手机服务端口，已取消关闭操作。' }

$serviceTree = New-Object 'System.Collections.Generic.HashSet[int]'
foreach ($processId in $protected) { $null = $serviceTree.Add($processId) }
do {
    $changed = $false
    foreach ($candidate in $snapshot) {
        if ($serviceTree.Contains([int]$candidate.ParentProcessId) -and
            ($candidate.Name -eq 'codex-code-mode-host.exe' -or $candidate.ExecutablePath -notmatch $desktopPattern)) {
            if ($serviceTree.Add([int]$candidate.ProcessId)) { $changed = $true }
        }
    }
} while ($changed)
foreach ($processId in $serviceTree) { $null = $protected.Add($processId) }
do {
    $changed = $false
    foreach ($candidate in $snapshot) {
        if ($protected.Contains([int]$candidate.ProcessId)) {
            if ($protected.Add([int]$candidate.ParentProcessId)) { $changed = $true }
        }
    }
} while ($changed)

# Windows 商店版的路径包含版本号；匹配安装目录，兼容桌面界面关闭后的后端残留。
$targets = @($snapshot | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath -match $desktopPattern -and
    -not $protected.Contains([int]$_.ProcessId)
})

if ($targets.Count -eq 0) {
    Write-Host '桌面端已关闭，没有发现需要清理的桌面进程。手机服务保持运行。'
    return
}

foreach ($target in $targets) {
    $processId = [int]$target.ProcessId
    if (-not $PSCmdlet.ShouldProcess("$($target.Name) (PID $processId)", '关闭桌面进程')) { continue }
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$processId"
    if (-not $current) { continue }
    # 防止 PID 重用误杀新进程，关闭前再次核对路径与创建时间。
    if ($current.ExecutablePath -ne $target.ExecutablePath -or $current.CreationDate -ne $target.CreationDate) {
        throw "PID $processId 已发生变化，已取消关闭。"
    }
    try { Stop-Process -Id $processId -Force }
    catch {
        if (Get-CimInstance Win32_Process -Filter "ProcessId=$processId") { throw }
    }
    $deadline = (Get-Date).AddSeconds(10)
    do {
        $remainingProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if (-not $remainingProcess -or $remainingProcess.HasExited) { break }
        Start-Sleep -Milliseconds 100
    } while ((Get-Date) -lt $deadline)
    if ($remainingProcess -and -not $remainingProcess.HasExited) { throw "桌面进程 $processId 未能退出。" }
    Write-Host "已关闭 $($target.Name) (PID $processId)。"
}

if (-not $WhatIfPreference) {
    $remaining = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath -match $desktopPattern -and
        -not $protected.Contains([int]$_.ProcessId)
    })
    if ($remaining.Count -gt 0) { throw '仍有桌面进程运行，请重试关闭脚本。' }
    Write-Host '桌面进程已关闭。手机 App Server、Relay 及其启动进程保持运行。'
}
