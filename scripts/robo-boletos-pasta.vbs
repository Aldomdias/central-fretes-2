' Abre o robo de boletos sem mostrar janela (usado pela tarefa agendada do Windows).
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.Run """" & fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "robo-boletos-pasta.cmd") & """", 0, True
