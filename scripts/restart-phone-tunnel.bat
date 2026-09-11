@echo off
setlocal
if not exist "%~dp0restart-phone-tunnel.ps1" (
  echo Missing script: "%~dp0restart-phone-tunnel.ps1"
  pause
  exit /b 1
)
start "" "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0restart-phone-tunnel.ps1"
exit /b
