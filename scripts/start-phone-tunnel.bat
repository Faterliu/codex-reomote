@echo off
setlocal
if not exist "%~dp0start-phone-tunnel-hidden.vbs" (
  echo Missing launcher: "%~dp0start-phone-tunnel-hidden.vbs"
  pause
  exit /b 1
)
"%SystemRoot%\System32\wscript.exe" "%~dp0start-phone-tunnel-hidden.vbs"
exit /b
