@echo off
REM ==========================================================================
REM  Organizer2 - Autostart einrichten (Windows)
REM  Legt eine Verknuepfung im Autostart-Ordner an, die die App bei jeder
REM  Anmeldung unsichtbar im Hintergrund startet. Einfach doppelklicken.
REM ==========================================================================
setlocal

set "VBS=%~dp0run-hidden.vbs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LNK=%STARTUP%\Organizer2.lnk"

echo.
echo Richte Autostart fuer Organizer2 ein...
echo   Skript:        %VBS%
echo   Autostart in:  %STARTUP%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%');" ^
  "$s.TargetPath='wscript.exe';" ^
  "$s.Arguments='\"%VBS%\"';" ^
  "$s.WorkingDirectory='%~dp0..';" ^
  "$s.IconLocation='wscript.exe,0';" ^
  "$s.Description='Organizer2 lokal starten';" ^
  "$s.Save()"

if exist "%LNK%" (
  echo Fertig! Organizer2 startet ab jetzt automatisch bei der Anmeldung.
  echo Die App ist dann unter http://localhost:3000 erreichbar.
  echo.
  echo Jetzt sofort starten? Schliesse dieses Fenster oder druecke eine Taste,
  echo um die App direkt zu starten...
  pause >nul
  wscript "%VBS%"
  echo App gestartet. Oeffne http://localhost:3000 im Browser.
) else (
  echo FEHLER: Verknuepfung konnte nicht angelegt werden.
)

echo.
pause
