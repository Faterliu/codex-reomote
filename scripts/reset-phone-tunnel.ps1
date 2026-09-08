<#
.SYNOPSIS
    手动重启本机 Codex App Server（供 app-codexapp / phone tunnel 使用）。

.DESCRIPTION
    仅重启监听 127.0.0.1:4500 的 Codex App Server。
    不会停止 Relay(4501)、SSH 反向隧道或服务器上的 cloudflared。

    建议先在手机端断开连接，再运行本脚本。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File C:\file\app-codexapp\scripts\reset-phone-tunnel.ps1
#>

[CmdletBinding()]
param(
    [int]$AppServerPort = 4500,
    [string]$TokenFile = "$env:USERPROFILE\.codex\app-server\mobile.token",
    [string]$LogDir = "$env:USERPROFILE\.codex\app-server\logs",
    [int]$StartTimeoutSeconds = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "[reset-phone-tunnel] $Message" -ForegroundColor Cyan
}

function Wait-PortFree {
    param([int]$Port, [int]$TimeoutSeconds = 10)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if (-not $listener) { return $true }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)

    return $false
}

function Wait-PortListen {
    param([int]$Port, [int]$TimeoutSeconds = 15)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $listener = Get-NetTCPConnection `
            -LocalAddress "127.0.0.1" `
            -LocalPort $Port `
            -State Listen `
            -ErrorAction SilentlyContinue

        if ($listener) { return $true }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    return $false
}

try {
    Write-Step "检查 Codex CLI..."
    $codex = Get-Command codex -ErrorAction Stop
    Write-Host "  Codex: $($codex.Source)"

    if (-not (Test-Path -LiteralPath $TokenFile)) {
        throw "找不到 mobile.token：$TokenFile"
    }

    $tokenLength = (Get-Item -LiteralPath $TokenFile).Length
    if ($tokenLength -le 0) {
        throw "mobile.token 文件为空：$TokenFile"
    }

    Write-Step "查找监听端口 $AppServerPort 的现有 App Server..."

    $listeners = Get-NetTCPConnection `
        -LocalPort $AppServerPort `
        -State Listen `
        -ErrorAction SilentlyContinue

    if ($listeners) {
        $pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique

        foreach ($pidValue in $pids) {
            $proc = Get-CimInstance Win32_Process `
                -Filter "ProcessId=$pidValue" `
                -ErrorAction SilentlyContinue

            if (-not $proc) { continue }

            $cmdLine = [string]$proc.CommandLine
            Write-Host "  PID=$pidValue  Name=$($proc.Name)"
            Write-Host "  CommandLine=$cmdLine"

            $looksLikeCodexAppServer =
                ($proc.Name -match '^codex(\.exe)?$') -or
                ($cmdLine -match '(?i)\bcodex\b.*\bapp-server\b')

            if (-not $looksLikeCodexAppServer) {
                throw "端口 $AppServerPort 被非 Codex App Server 进程占用（PID=$pidValue）。为避免误杀，脚本已停止。"
            }

            Write-Step "停止旧 App Server，PID=$pidValue ..."
            Stop-Process -Id $pidValue -Force
        }

        if (-not (Wait-PortFree -Port $AppServerPort -TimeoutSeconds 10)) {
            throw "停止旧进程后，端口 $AppServerPort 仍未释放。"
        }
    }
    else {
        Write-Host "  当前没有进程监听 $AppServerPort，将直接启动新的 App Server。"
    }

    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $stdoutLog = Join-Path $LogDir "app-server-$timestamp.out.log"
    $stderrLog = Join-Path $LogDir "app-server-$timestamp.err.log"

    $listenUrl = "ws://127.0.0.1:$AppServerPort"
    $escapedToken = $TokenFile.Replace("'", "''")
    $escapedListen = $listenUrl.Replace("'", "''")

    $childCommand = @"
`$ErrorActionPreference = 'Stop'
& codex app-server --listen '$escapedListen' --ws-auth capability-token --ws-token-file '$escapedToken'
"@

    Write-Step "启动新的 Codex App Server..."
    Write-Host "  Listen : $listenUrl"
    Write-Host "  Token  : $TokenFile"
    Write-Host "  Stdout : $stdoutLog"
    Write-Host "  Stderr : $stderrLog"

    $child = Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-Command", $childCommand
        ) `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -PassThru

    if (-not (Wait-PortListen -Port $AppServerPort -TimeoutSeconds $StartTimeoutSeconds)) {
        Write-Host ""
        Write-Host "App Server 未在超时时间内开始监听。" -ForegroundColor Red

        if (Test-Path $stderrLog) {
            Write-Host "---- stderr ----" -ForegroundColor Yellow
            Get-Content $stderrLog -Tail 30
        }

        throw "启动失败，请检查日志：$stderrLog"
    }

    $newListener = Get-NetTCPConnection `
        -LocalAddress "127.0.0.1" `
        -LocalPort $AppServerPort `
        -State Listen `
        -ErrorAction SilentlyContinue |
        Select-Object -First 1

    Write-Host ""
    Write-Host "Codex App Server 已重新启动。" -ForegroundColor Green

    if ($newListener) {
        Write-Host "  Listener PID : $($newListener.OwningProcess)"
    }

    Write-Host "  Address      : $listenUrl"
    Write-Host ""
    Write-Host "Relay(4501)、SSH 反向隧道、cloudflared 均未被重启。"
    Write-Host "现在可重新打开电脑端会话，或重新连接手机 App。"
}
catch {
    Write-Host ""
    Write-Host "重启失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
