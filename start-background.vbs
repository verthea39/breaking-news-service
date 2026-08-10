Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
ScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

WshShell.CurrentDirectory = ScriptDir

If Not fso.FolderExists(ScriptDir & "\logs") Then
    fso.CreateFolder(ScriptDir & "\logs")
End If

WshShell.Run """C:\Program Files\nodejs\node.exe"" index.js", 0, False

