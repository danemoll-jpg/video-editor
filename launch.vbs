' Launches Dan's Video Studio without popping up a console window.
' Double-click this file directly, or use the Desktop shortcut created for it.
' Rebuilds first (npm start = build + run) so the launcher always reflects
' the latest code in this repo.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
repoDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = repoDir
shell.Run "cmd /c npm start", 0, False
