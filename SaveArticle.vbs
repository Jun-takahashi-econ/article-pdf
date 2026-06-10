' SaveArticle.vbs — ダブルクリックでURL入力ボックスを表示(黒い画面を出さないためのラッパー)
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir_ = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir_ & "\SaveArticle.ps1""", 0, False
