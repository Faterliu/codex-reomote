Option Explicit

Dim shell, fileSystem, scriptDirectory, powerShellScript, command
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
powerShellScript = fileSystem.BuildPath(scriptDirectory, "start-phone-tunnel.ps1")

If Not fileSystem.FileExists(powerShellScript) Then
  WScript.Quit 1
End If

command = """" & shell.ExpandEnvironmentStrings("%SystemRoot%") & _
  "\System32\WindowsPowerShell\v1.0\powershell.exe""" & _
  " -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & _
  powerShellScript & """"

' Window style 0 creates no visible or minimized terminal; False keeps it asynchronous.
shell.Run command, 0, False
