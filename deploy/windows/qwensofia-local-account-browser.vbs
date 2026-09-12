Option Explicit

Dim shell, fso, scriptDir, deployDir, repoDir, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
deployDir = fso.GetParentFolderName(scriptDir)
repoDir = fso.GetParentFolderName(deployDir)
command = "cmd.exe /d /c cd /d """ & repoDir & """ && npm run account-browser:local"

Do
  exitCode = shell.Run(command, 0, True)
  WScript.Sleep 5000
Loop
