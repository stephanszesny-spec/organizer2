' ===========================================================================
'  Organizer2 – startet den lokalen Server unsichtbar im Hintergrund.
'  Wird vom Autostart-Eintrag aufgerufen (siehe scripts\install-autostart.bat).
'  Ermittelt das Projektverzeichnis automatisch aus dem eigenen Pfad,
'  ist also unabhaengig davon, wo der Ordner liegt (z. B. im OneDrive).
' ===========================================================================
Option Explicit

Dim fso, sh, scriptDir, projectDir
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

' scripts\  ->  Projekt-Hauptordner
scriptDir  = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)

sh.CurrentDirectory = projectDir

' node server.js unsichtbar starten (0 = kein Fenster, False = nicht warten).
' Ausgaben landen zur Fehlersuche in organizer2.log im Projektordner.
sh.Run "cmd /c node server.js > organizer2.log 2>&1", 0, False
