@echo off
rem Double-click to play ebb from this folder in your browser.
rem It starts a small local web server (tools\serve.ps1) and opens the game.
title ebb, starting
cd /d "%~dp0"

if not exist "%~dp0tools\serve.ps1" (
  echo.
  echo   Couldn't find the ebb files next to play.cmd.
  echo   play.cmd needs to stay inside the ebb folder, next to index.html and the tools folder.
  echo   If you moved it, put it back, or open the ebb folder in GitHub Desktop and use the play.cmd there.
  echo.
  pause
  exit /b 1
)

where powershell >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Windows PowerShell wasn't found on this computer, so the local server can't start.
  echo   It is normally part of Windows. Try restarting the computer and double-clicking play.cmd again.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1"
set "EBB_EXIT=%ERRORLEVEL%"

rem serve.ps1 exits with 3 after it has already shown its own message.
if not "%EBB_EXIT%"=="0" if not "%EBB_EXIT%"=="3" (
  echo.
  echo   The local server stopped unexpectedly. The lines above say what went wrong.
  echo   Try double-clicking play.cmd again. If it keeps happening, copy this window's text to Claude.
  echo.
  pause
)
