#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [ValidateRange(1,2100000000)][int]$VersionCode = 1,
    [string]$ChangelogFile,
    [switch]$ForceUpdate,
    [ValidateRange(1,2100000000)][int]$MinSupportedVersionCode = 1,
    [string]$BuildRoot = "$env:USERPROFILE\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\CodexAndroidBuild",
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$repo = Split-Path $PSScriptRoot -Parent
$mobile = Join-Path $repo 'apps/mobile'
$android = Join-Path $mobile 'android'
$server = 'admin@8.148.73.94'
$baseUrl = 'https://updates.yinxingye.space/apps/codexapp'
$sshArgs = @('-o','BatchMode=yes','-o','ConnectTimeout=15')
$utf8 = [Text.UTF8Encoding]::new($false)
function Run([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE)." }
}
function Capture([string]$Command, [string[]]$Arguments) {
    $lines = & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE)." }
    return ($lines -join "`n")
}
function WriteUtf8([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, $utf8) }
function FileSha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
function Certificate([string]$Apk) {
    $result = Capture $script:signer @('verify','--verbose','--print-certs',$Apk)
    $digests = [regex]::Matches($result, 'Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]+)')
    if ($digests.Count -ne 1) { throw 'Expected exactly one APK signing certificate.' }
    return $digests[0].Groups[1].Value.ToLowerInvariant()
}
$oldEnv = @{}
foreach ($key in @('JAVA_HOME','ANDROID_HOME','ANDROID_SDK_ROOT','NODE_ENV','CI','PATH')) { $oldEnv[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
$lock = $null
$stage = $null
$transcript = $false
Push-Location $repo
try {
    foreach ($command in @('node','pnpm','ssh','scp')) { $null = Get-Command $command -ErrorAction Stop }
    $jdk = Join-Path $BuildRoot 'jdk/jdk-17.0.20.1+1'
    $sdk = Join-Path $BuildRoot 'android-sdk'
    $script:signer = Join-Path $sdk 'build-tools/36.0.0/apksigner.bat'
    $aapt = Join-Path $sdk 'build-tools/36.0.0/aapt.exe'
    foreach ($required in @("$jdk/bin/java.exe",$script:signer,$aapt)) { if (!(Test-Path -LiteralPath $required)) { throw "Missing tool: $required" } }
    if ((Get-Content (Join-Path $repo '.npmrc') -Raw) -notmatch '(?m)^node-linker=hoisted\s*$') { throw 'The repository must use node-linker=hoisted.' }
    $latest = Invoke-RestMethod "$baseUrl/latest.json?check=$([Guid]::NewGuid().ToString('N'))" -TimeoutSec 30
    if ($latest.appId -ne 'codexapp' -or $latest.packageName -ne 'com.anonymous.mobile' -or $latest.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or !$latest.apkUrl.StartsWith("$baseUrl/apk/")) { throw 'Unexpected server manifest.' }
    Run ssh ($sshArgs + @($server, 'sudo -n test -w /var/www/updates/apps/codexapp && command -v python3'))
    if ($CheckOnly) { Write-Host "Preflight passed. Server version: $($latest.versionName) ($($latest.versionCode)). No build or upload performed."; return }
    if (!$Version -or !$PSBoundParameters.ContainsKey('VersionCode') -or !$ChangelogFile) { throw 'Specify -Version, -VersionCode and -ChangelogFile, or use -CheckOnly.' }
    if ($VersionCode -le [int]$latest.versionCode -or $MinSupportedVersionCode -gt $VersionCode) { throw 'VersionCode must exceed the server version; minimum supported version must not exceed it.' }
    $notes = @([IO.File]::ReadAllLines((Resolve-Path -LiteralPath $ChangelogFile).Path, $utf8) | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 0 })
    if ($notes.Count -eq 0) { throw 'Changelog must not be empty.' }
    $dist = Join-Path $repo 'dist'
    $null = New-Item -ItemType Directory -Force $dist
    $lock = [IO.File]::Open((Join-Path $dist 'android-release.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    $runId = [Guid]::NewGuid().ToString('N')
    $out = Join-Path $dist "codexapp-$Version-$VersionCode-$runId"
    $null = New-Item -ItemType Directory $out
    Start-Transcript -Path (Join-Path $out 'release.log') | Out-Null
    $transcript = $true
    $env:JAVA_HOME = $jdk
    $env:ANDROID_HOME = $sdk
    $env:ANDROID_SDK_ROOT = $sdk
    $env:CI = '1'
    $env:NODE_ENV = 'development'
    $env:PATH = "$jdk\bin;$env:PATH"
    Run pnpm @('install','--frozen-lockfile','--prod=false')
    $core = Capture node @('-p',"require.resolve('expo-modules-core/package.json', { paths: [require('path').resolve('apps/mobile')] })")
    if ($core -match '[\\/]\.pnpm[\\/]') { throw 'Native module still resolves through the old isolated layout.' }
    Run pnpm @('typecheck')
    $env:NODE_ENV = 'production'
    $previousApk = Join-Path $out 'previous.apk'
    Invoke-WebRequest -UseBasicParsing $latest.apkUrl -OutFile $previousApk -TimeoutSec 300
    if ((FileSha256 $previousApk) -ne $latest.sha256.ToLowerInvariant()) { throw 'Previous APK hash mismatch.' }
    $previousCertificate = Certificate $previousApk
    $configPath = Join-Path $mobile 'app.json'
    $config = Get-Content $configPath -Raw -Encoding utf8 | ConvertFrom-Json
    $config.expo.version = $Version
    $config.expo.android.versionCode = $VersionCode
    WriteUtf8 $configPath (($config | ConvertTo-Json -Depth 50) + "`n")
    Push-Location $mobile
    try { Run pnpm @('exec','expo','prebuild','--platform','android','--no-install') } finally { Pop-Location }
    WriteUtf8 (Join-Path $android 'local.properties') ("sdk.dir=" + $sdk.Replace('\','/').Replace(':','\:') + "`n")
    Push-Location $android
    try { Run (Join-Path $android 'gradlew.bat') @('assembleRelease','--no-daemon') } finally { Pop-Location }
    $builtApk = Join-Path $android 'app/build/outputs/apk/release/app-release.apk'
    $badging = Capture $aapt @('dump','badging',$builtApk)
    if ($badging -notmatch "package: name='com.anonymous.mobile' versionCode='$VersionCode' versionName='$([regex]::Escape($Version))'") { throw 'Built APK package or version does not match the requested release.' }
    if ((Certificate $builtApk) -ne $previousCertificate) { throw 'APK signing certificate changed. Publication stopped.' }
    $seeds = Join-Path $android 'app/build/outputs/mapping/release/seeds.txt'
    if (!(Test-Path $seeds) -or !(Select-String -LiteralPath $seeds -SimpleMatch 'com.codexmobile.appupdater.CodexAppUpdaterModule' -Quiet)) {
        throw 'Native updater module is missing from the release keep report.'
    }
    $apkName = "codexapp-v$Version-$VersionCode.apk"
    $apk = Join-Path $out $apkName
    Copy-Item -LiteralPath $builtApk -Destination $apk
    Write-Host 'Generating release manifest...'
    $hash = (FileSha256 $apk)
    $manifest = [ordered]@{ appId='codexapp'; packageName='com.anonymous.mobile'; versionCode=$VersionCode; versionName=$Version; apkUrl="$baseUrl/apk/$apkName"; sha256=$hash; fileSize=(Get-Item $apk).Length; forceUpdate=[bool]$ForceUpdate; minSupportedVersionCode=$MinSupportedVersionCode; releaseTime=[DateTimeOffset]::Now.ToString('o'); changelog=$notes }
    $manifestPath = Join-Path $out 'latest.json'
    WriteUtf8 $manifestPath (($manifest | ConvertTo-Json -Depth 10) + "`n")
    Write-Host 'Uploading validated APK and manifest...'
    $stage = "/tmp/codexapp-release-$runId"
    Run ssh ($sshArgs + @($server, "umask 077; mkdir '$stage'"))
    Run scp ($sshArgs + @($apk,$manifestPath,(Join-Path $PSScriptRoot 'publish-android-release.py'),"${server}:$stage/"))
    Run ssh ($sshArgs + @($server, "sudo -n python3 '$stage/publish-android-release.py' '$stage' '$($latest.sha256)'"))
    Write-Host 'Verifying published files over HTTPS...'
    $published = Invoke-RestMethod "$baseUrl/latest.json?verify=$runId" -TimeoutSec 30
    if ($published.sha256 -ne $hash -or $published.versionCode -ne $VersionCode) { throw 'Publication command completed, but public manifest verification failed. Inspect server before retrying.' }
    $downloaded = Join-Path $out 'verified-download.apk'
    Invoke-WebRequest -UseBasicParsing "$($manifest.apkUrl)?verify=$runId" -OutFile $downloaded -TimeoutSec 300
    if ((FileSha256 $downloaded) -ne $hash) { throw 'Publication completed, but public APK hash verification failed.' }
    Remove-Item -LiteralPath $downloaded,$previousApk -Force
    Write-Host "Published $Version ($VersionCode): $($manifest.apkUrl)"
    Write-Host "Archive and log: $out"
} finally {
    if ($stage) {
        & ssh @sshArgs $server "rm -f -- '$stage/latest.json' '$stage/publish-android-release.py' '$stage/$apkName'; rmdir -- '$stage'" | Out-Host
        if ($LASTEXITCODE -ne 0) { Write-Warning "Could not clean remote staging directory: $stage" }
    }
    if ($transcript) { Stop-Transcript | Out-Null }
    if ($lock) { $lock.Dispose() }
    foreach ($key in $oldEnv.Keys) { [Environment]::SetEnvironmentVariable($key,$oldEnv[$key],'Process') }
    Pop-Location
}