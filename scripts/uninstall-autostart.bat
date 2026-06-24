@echo off
REM ==========================================================================
REM  Organizer2 - Autostart wieder entfernen (Windows)
REM ==========================================================================
setlocal

set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Organizer2.lnk"

if exist "%LNK%" (
  del "%LNK%"
  echo Autostart-Eintrag entfernt. Organizer2 startet nicht mehr automatisch.
) else (
  echo Kein Autostart-Eintrag gefunden - nichts zu tun.
)

echo.
pause
