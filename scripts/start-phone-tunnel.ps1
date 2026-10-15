[CmdletBinding()]
param(
  [string]$ServerHost = "8.148.73.94",
  [string]$ServerUser = "admin",
  [string]$PublicUrl = "wss://codex.yinxingye.space",
  [ValidateRange(1,65535)][int]$AppServerPort = 4500,
  [ValidateRange(1,65535)][int]$RelayPort = 4501,
  [switch]$Once,
  [switch]$LocalOnly,
  [switch]$CheckOnly,
  [ValidateRange(10,3600)][int]$CheckIntervalSeconds = 60,
  [string]$TokenRoot = (Join-Path $env:USERPROFILE ".codex\app-server"),
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "CodexMobilePhoneTunnel")
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$MobileTokenFile = Join-Path $TokenRoot 'mobile.token'
$RelayTokenFile = Join-Path $TokenRoot 'relay.token'
$CodexCommand = Join-Path $env:APPDATA 'npm\codex.cmd'
$NodeCommand = (Get-Command node -ErrorAction Stop).Source
$SshCommand = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
$NetstatCommand = Join-Path $env:SystemRoot 'System32\netstat.exe'
$RelayScript = Join-Path $PSScriptRoot 'app-server-relay.mjs'
$HealthProbeScript = Join-Path $PSScriptRoot 'phone-tunnel-probe.mjs'
$LogRoot = Join-Path $RuntimeRoot 'logs'
$WatcherLogFile = Join-Path $LogRoot 'watcher.log'
$WatcherPidFile = Join-Path $RuntimeRoot 'watcher.pid'
$RecoveryStateFile = Join-Path $RuntimeRoot "recovery-$AppServerPort-$RelayPort.json"
$RemoteTarget = "$ServerUser@$ServerHost"
if ($AppServerPort -eq $RelayPort) { throw 'App Server and Relay must use different ports.' }
if ($ServerHost -notmatch '^[a-zA-Z0-9.-]+$' -or $ServerUser -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid SSH target.' }
if (-not $LocalOnly) {
  $public = [Uri]$PublicUrl
  if (-not $public.IsAbsoluteUri -or $public.Scheme -ne 'wss') { throw 'PublicUrl must use wss.' }
}
foreach ($required in @($MobileTokenFile,$RelayTokenFile,$CodexCommand,$RelayScript,$HealthProbeScript,$NetstatCommand)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required path is missing: $required" }
}
if (-not $LocalOnly -and -not (Test-Path -LiteralPath $SshCommand)) { throw 'OpenSSH is missing.' }
if ([string]::IsNullOrWhiteSpace((Get-Content -LiteralPath $MobileTokenFile -Raw -Encoding utf8))) { throw 'App Server token is empty.' }
if ((Get-Content -LiteralPath $RelayTokenFile -Raw -Encoding utf8).Trim().Length -lt 20) { throw 'Relay token is unexpectedly short.' }

function Write-WatcherLog {
  param([string]$Message)
  $safe = $Message -replace '(?i)(relay_token=)[^&\s]+','$1[REDACTED]' -replace '(?i)(Bearer\s+)\S+','$1[REDACTED]'
  Add-Content -LiteralPath $WatcherLogFile -Value "$(Get-Date -Format o) $safe" -Encoding utf8
}

function Wait-For {
  param([scriptblock]$Condition, [string]$Description, [int]$TimeoutSeconds = 15)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 400
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for $Description."
}

function Invoke-PhoneRpcProbe {
  param([string]$Url, [string]$TokenFile, [string]$Auth = 'bearer')
  $output = & $NodeCommand $HealthProbeScript $Url $TokenFile $Auth
  try { return ($output -join "`n" | ConvertFrom-Json -ErrorAction Stop) }
  catch { return [pscustomobject]@{ ok = $false; reason = 'probe-error' } }
}

function Get-PhoneEndpointProbe {
  param([ValidateSet('appServer','relay')][string]$Service)
  if ($Service -eq 'appServer') {
    return Invoke-PhoneRpcProbe -Url "ws://127.0.0.1:$AppServerPort" -TokenFile $MobileTokenFile
  }
  return Invoke-PhoneRpcProbe -Url "ws://127.0.0.1:$RelayPort" -TokenFile $RelayTokenFile -Auth 'query'
}

function Get-PhoneListenerPids {
  param([int]$Port)
  $endpoints = @("127.0.0.1:$Port", "[::1]:$Port")
  $listeners = foreach ($line in (& $NetstatCommand -ano -p tcp)) {
    if ($line -match '^\s*TCP\s+(?<local>\S+)\s+\S+\s+LISTENING\s+(?<pid>\d+)\s*$' -and $endpoints -contains $Matches.local) {
      [int]$Matches.pid
    }
  }
  return @($listeners | Sort-Object -Unique)
}

function Test-OwnedPhoneListener {
  param($Process, [string]$Service)
  if (-not $Process -or -not $Process.CommandLine) { return $false }
  if ($Service -eq 'relay') {
    return $Process.Name -eq 'node.exe' -and $Process.CommandLine.Contains($RelayScript)
  }
  return $Process.Name -eq 'codex.exe' -and $Process.CommandLine -match '\bapp-server\b' -and
    $Process.CommandLine.Contains("ws://127.0.0.1:$AppServerPort") -and
    $Process.CommandLine.Contains($MobileTokenFile)
}

function Stop-VerifiedPhoneProcess {
  param($Process, [string]$Description)
  # PID 可能被复用；停止前再次核对创建时间和命令行。
  $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($Process.ProcessId)" -ErrorAction Stop
  if (-not $current) { return }
  if ($current.CreationDate -ne $Process.CreationDate -or $current.CommandLine -ne $Process.CommandLine) {
    throw "Process identity changed; refusing to stop $Description."
  }
  Stop-Process -Id $current.ProcessId -Force -ErrorAction Stop
  Write-WatcherLog "Stopped $Description (PID $($current.ProcessId))."
}

function Assert-PhoneRestartCooldown {
  param([string]$Service)
  $state = @{}
  if (Test-Path -LiteralPath $RecoveryStateFile) {
    try {
      $saved = Get-Content -LiteralPath $RecoveryStateFile -Raw -Encoding utf8 | ConvertFrom-Json
      foreach ($property in $saved.PSObject.Properties) { $state[$property.Name] = $property.Value }
    } catch { throw 'Recovery state cannot be read; automatic restart cancelled.' }
  }
  if ($state.ContainsKey($Service)) {
    $last = [DateTimeOffset]::Parse($state[$Service])
    if (([DateTimeOffset]::UtcNow - $last).TotalSeconds -lt 180) {
      throw "$Service restart cooldown is active; retrying on a later health check."
    }
  }
  $state[$Service] = [DateTimeOffset]::UtcNow.ToString('o')
  $state | ConvertTo-Json | Set-Content -LiteralPath $RecoveryStateFile -Encoding utf8
}

function Ensure-PhoneLocalService {
  param([ValidateSet('appServer','relay')][string]$Service)
  $probe = Get-PhoneEndpointProbe -Service $Service
  if ($probe.ok) { return $null }
  if ($probe.reason -in @('configuration','authentication','protocol','probe-error')) {
    throw "$Service health check failed ($($probe.reason)); check configuration before restarting."
  }
  $port = if ($Service -eq 'appServer') { $AppServerPort } else { $RelayPort }
  $listeners = @(Get-PhoneListenerPids -Port $port)
  if ($listeners.Count -gt 0) {
    # 手动启动及连续失败后的自动恢复都复检一次，避免瞬时延迟触发重启。
    $retry = Get-PhoneEndpointProbe -Service $Service
    if ($retry.ok) { return $null }
    if ($retry.reason -in @('configuration','authentication','protocol','probe-error')) {
      throw "$Service health check failed ($($retry.reason)); restart cancelled."
    }
    $owned = @($listeners | ForEach-Object { Get-CimInstance Win32_Process -Filter "ProcessId=$_" })
    if (@($owned | Where-Object { -not (Test-OwnedPhoneListener -Process $_ -Service $Service) }).Count -gt 0 -or $owned.Count -ne $listeners.Count) {
      throw "Port $port is occupied by an unrecognized process; leaving it untouched."
    }
    Assert-PhoneRestartCooldown -Service $Service
    foreach ($process in $owned) { Stop-VerifiedPhoneProcess -Process $process -Description $Service }
    Wait-For -Condition { @(Get-PhoneListenerPids -Port $port).Count -eq 0 } -Description "$Service port release"
  }
  Write-WatcherLog "Starting $Service after failed health check ($($probe.reason))."
  $output = Join-Path $LogRoot "$RunId-$Service.stdout.log"
  $errorLog = Join-Path $LogRoot "$RunId-$Service.stderr.log"
  if ($Service -eq 'appServer') {
    $process = Start-Process -FilePath $CodexCommand -ArgumentList @(
      'app-server','--listen',"ws://127.0.0.1:$AppServerPort",'--ws-auth','capability-token',
      '--ws-token-file',('"' + $MobileTokenFile + '"')
    ) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $output -RedirectStandardError $errorLog -PassThru
  } else {
    $variables = @{
      RELAY_LISTEN_HOST = '127.0.0.1'; RELAY_LISTEN_PORT = "$RelayPort"
      RELAY_TOKEN = (Get-Content -LiteralPath $RelayTokenFile -Raw -Encoding utf8).Trim()
      UPSTREAM_WS_URL = "ws://127.0.0.1:$AppServerPort"; UPSTREAM_TOKEN_FILE = $MobileTokenFile
      UPSTREAM_UNIX_SOCKET = ''
    }
    $previous = @{}
    try {
      foreach ($key in $variables.Keys) {
        $previous[$key] = [Environment]::GetEnvironmentVariable($key,'Process')
        [Environment]::SetEnvironmentVariable($key,$variables[$key],'Process')
      }
      $process = Start-Process -FilePath $NodeCommand -ArgumentList @('"' + $RelayScript + '"') -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $output -RedirectStandardError $errorLog -PassThru
    } finally {
      foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key,$previous[$key],'Process') }
    }
  }
  Wait-For -Condition { (Get-PhoneEndpointProbe -Service $Service).ok } -Description "$Service authenticated initialization" -TimeoutSeconds 25
  Write-WatcherLog "$Service initialization succeeded after start (launcher PID $($process.Id))."
  return $process.Id
}

function Invoke-PhoneSshRead {
  param([string]$Command)
  # PS 5.1 会把原生 stderr 转成错误；用退出码分类，避免泄漏原始输出或提前跳过恢复。
  $preference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $SshCommand -F NUL -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=5 -o ConnectionAttempts=1 -o ServerAliveInterval=5 -o ServerAliveCountMax=2 $RemoteTarget $Command 2>$null
    return [pscustomobject]@{ ok = ($LASTEXITCODE -eq 0); output = ($output -join "`n").Trim() }
  } finally { $ErrorActionPreference = $preference }
}

function Get-PhoneRemoteState {
  $result = Invoke-PhoneSshRead -Command "if test `"`$(curl --noproxy '*' --fail --silent --max-time 4 http://127.0.0.1:$RelayPort/readyz)`" = ok; then printf READY; elif test -n `"`$(ss -ltnH 'sport = :$RelayPort')`"; then printf OCCUPIED; else printf FREE; fi"
  if (-not $result.ok) { return 'UNREACHABLE' }
  if ($result.output -in @('READY','OCCUPIED','FREE')) { return $result.output }
  return 'UNREACHABLE'
}

function Get-OwnedPhoneTunnels {
  $forward = "127.0.0.1:$RelayPort`:127.0.0.1:$RelayPort"
  return @(Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" | Where-Object {
    $_.ExecutablePath -eq $SshCommand -and $_.CommandLine -and
    $_.CommandLine -match ('(?:^|\s)-R\s+"?' + [regex]::Escape($forward) + '"?(?:\s|$)') -and
    $_.CommandLine -match ('(?:^|\s)"?' + [regex]::Escape($RemoteTarget) + '"?(?:\s|$)')
  })
}

function Repair-PhoneReverseTunnel {
  $remote = Get-PhoneRemoteState
  if ($remote -eq 'READY') { return $null }
  if ($remote -eq 'UNREACHABLE') { throw 'SSH unavailable; preserving local services and retrying after the network recovers.' }
  $owned = @(Get-OwnedPhoneTunnels)
  foreach ($process in $owned) { Stop-VerifiedPhoneProcess -Process $process -Description 'unhealthy reverse tunnel' }
  if ($remote -eq 'OCCUPIED') {
    Write-WatcherLog 'Waiting for stale remote forwarding port to be released; no remote process is stopped.'
    $deadline = (Get-Date).AddSeconds(30)
    do {
      Start-Sleep -Seconds 2
      $remote = Get-PhoneRemoteState
      if ($remote -eq 'READY') { return $null }
      if ($remote -eq 'FREE') { break }
      if ($remote -eq 'UNREACHABLE') { throw 'SSH became unavailable while waiting for remote port release.' }
    } while ((Get-Date) -lt $deadline)
    if ($remote -ne 'FREE') { throw 'Remote forwarding port remains occupied; leaving server processes untouched and retrying later.' }
  }
  $tunnel = Start-Process -FilePath $SshCommand -ArgumentList @(
    '-F','NUL','-N','-o','BatchMode=yes','-o','ConnectTimeout=5','-o','ConnectionAttempts=1',
    '-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15',
    '-o','ServerAliveCountMax=2','-o','TCPKeepAlive=yes','-R',"127.0.0.1:$RelayPort`:127.0.0.1:$RelayPort",$RemoteTarget
  ) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogRoot "$RunId-reverse-tunnel.stdout.log") -RedirectStandardError (Join-Path $LogRoot "$RunId-reverse-tunnel.stderr.log") -PassThru
  try {
    Wait-For -Condition { (Get-PhoneRemoteState) -eq 'READY' } -Description 'SSH reverse tunnel readiness' -TimeoutSeconds 25
  } catch {
    $tunnel.Refresh()
    if (-not $tunnel.HasExited) { $tunnel.Kill(); $tunnel.WaitForExit(5000) | Out-Null }
    throw
  }
  Write-WatcherLog "Started reverse tunnel (PID $($tunnel.Id))."
  return $tunnel.Id
}

function Get-PhoneHealthStatus {
  foreach ($service in @('appServer','relay')) {
    $probe = Get-PhoneEndpointProbe -Service $service
    if (-not $probe.ok) { return [pscustomobject]@{ ok = $false; stage = $service; reason = $probe.reason } }
  }
  if (-not $LocalOnly) {
    $remote = Get-PhoneRemoteState
    if ($remote -ne 'READY') { return [pscustomobject]@{ ok = $false; stage = 'reverseTunnel'; reason = $remote } }
    $probe = Invoke-PhoneRpcProbe -Url $PublicUrl -TokenFile $RelayTokenFile -Auth 'query'
    if (-not $probe.ok) { return [pscustomobject]@{ ok = $false; stage = 'public'; reason = $probe.reason } }
  }
  return [pscustomobject]@{ ok = $true; stage = 'ready'; reason = 'ready' }
}
if ($CheckOnly) { Get-PhoneHealthStatus | ConvertTo-Json; return }
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

function Invoke-PhoneRepair {
  $repairLock = New-Object System.Threading.Mutex($false, "Global\CodexPhoneRepair-$AppServerPort-$RelayPort")
  $locked = $false
  try {
    try { $locked = $repairLock.WaitOne([TimeSpan]::FromSeconds(30)) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Another repair is still running; the watcher will retry.' }
    $RunId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    Write-WatcherLog 'Checking authenticated initialization and repairing unhealthy components.'
    $started = [ordered]@{ appServer = (Ensure-PhoneLocalService -Service appServer); relay = (Ensure-PhoneLocalService -Service relay); reverseTunnel = $null }
    if (-not $LocalOnly) { $started.reverseTunnel = Repair-PhoneReverseTunnel }
    $health = Get-PhoneHealthStatus
    if (-not $health.ok) { throw "Health check still fails at $($health.stage) ($($health.reason)); healthy local services are preserved." }
    $safePublicUrl = if ($LocalOnly) { $null } else { $builder = [UriBuilder]$PublicUrl; $builder.Query = ''; $builder.Fragment = ''; $builder.Uri.AbsoluteUri }
    [ordered]@{ startedAt = (Get-Date).ToString('o'); server = $RemoteTarget; appServerPort = $AppServerPort; relayPort = $RelayPort; publicUrl = $safePublicUrl; started = $started; logs = $LogRoot } |
      ConvertTo-Json | Set-Content -LiteralPath (Join-Path $RuntimeRoot 'last-start.json') -Encoding utf8
    Write-WatcherLog 'Phone connection initialization succeeded.'
    Write-Host 'Phone connection is ready.'
  } finally {
    if ($locked) { $repairLock.ReleaseMutex() }
    $repairLock.Dispose()
  }
}

if ($Once) { Invoke-PhoneRepair; return }
$watchLock = New-Object System.Threading.Mutex($false, "Global\CodexPhoneWatch-$AppServerPort-$RelayPort")
$watchLocked = $false
try {
  Write-WatcherLog "Watcher process $PID starting."
  try { $watchLocked = $watchLock.WaitOne([TimeSpan]::Zero) } catch [System.Threading.AbandonedMutexException] { $watchLocked = $true }
  if (-not $watchLocked) {
    # 重复双击立即执行一次检查/修复，已有监控器继续运行。
    Write-WatcherLog "Watcher process $PID found another active watcher; running immediate repair."
    Invoke-PhoneRepair
    return
  }
  $PID | Set-Content -LiteralPath $WatcherPidFile -Encoding ascii
  Write-WatcherLog "Watcher process $PID acquired its lock and wrote its PID file."
  try { Invoke-PhoneRepair } catch { Write-WatcherLog "Initial repair failed: $($_.Exception.Message)" }
  $failures = 0
  $lastStage = ''
  while ($true) {
    Start-Sleep -Seconds $CheckIntervalSeconds
    $health = Get-PhoneHealthStatus
    if ($health.ok) {
      if ($failures -gt 0) { Write-WatcherLog 'Connection recovered.' }
      $failures = 0
      $lastStage = ''
      continue
    }
    if ($lastStage -ne $health.stage) { $failures = 0 }
    $lastStage = $health.stage
    $failures++
    Write-WatcherLog "Health check failed ($failures/2): $($health.stage) ($($health.reason))."
    if ($failures -ge 2) {
      try { Invoke-PhoneRepair } catch { Write-WatcherLog "Automatic repair failed: $($_.Exception.Message)" }
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
