@echo off
REM ==========================================================================
REM  Organizer2 - laufenden Hintergrund-Server beenden (Windows)
REM  Beendet gezielt den node-Prozess, der server.js ausfuehrt.
REM ==========================================================================
setlocal

powershell -NoProfile -Command ^
  "$p = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*server.js*' };" ^
  "if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Write-Host 'Organizer2 wurde beendet.' } else { Write-Host 'Kein laufender Organizer2-Server gefunden.' }"

echo.
pause
