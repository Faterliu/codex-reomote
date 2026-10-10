@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-codex-desktop.ps1" %*
if errorlevel 1 pause
exit /b %errorlevel%
