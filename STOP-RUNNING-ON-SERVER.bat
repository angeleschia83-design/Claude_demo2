@echo off
setlocal EnableDelayedExpansion
title Stop the device register running on its own

rem --------------------------------------------------------------------------
rem  Undoes KEEP-RUNNING-ON-SERVER.bat: stops the register and removes the
rem  task, so it no longer starts with Windows.
rem
rem  RIGHT-CLICK this file and choose "Run as administrator".
rem
rem  Nothing is deleted. The register and its data are untouched; you can
rem  still start it by hand with RUN-ON-WINDOWS.bat.
rem --------------------------------------------------------------------------

set "TASKNAME=DeviceRegister"

echo.
echo   Stop the device register running on its own
echo   ===========================================
echo.

net session >nul 2>&1
if errorlevel 1 (
  echo   This needs administrator rights.
  echo   Close this window, RIGHT-CLICK this file, and choose
  echo   "Run as administrator".
  echo.
  pause
  exit /b 1
)

schtasks /Query /TN "!TASKNAME!" >nul 2>&1
if errorlevel 1 (
  echo   There is no "!TASKNAME!" task, so there is nothing to undo.
  echo.
  pause
  exit /b 0
)

echo   Stopping it...
schtasks /End /TN "!TASKNAME!" >nul 2>&1
echo   Removing the task...
schtasks /Delete /TN "!TASKNAME!" /F
if errorlevel 1 (
  echo.
  echo   Windows refused to remove it. The message above says why.
  echo.
  pause
  exit /b 1
)

echo.
echo   Done. The register no longer starts on its own.
echo   Its data is untouched -- start it by hand with RUN-ON-WINDOWS.bat.
echo.
pause
