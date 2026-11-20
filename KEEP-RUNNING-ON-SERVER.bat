@echo off
setlocal EnableDelayedExpansion
title Keep the device register running

rem --------------------------------------------------------------------------
rem  Makes the register start with Windows and keep running when nobody is
rem  logged on, so disconnecting no longer stops it.
rem
rem  RIGHT-CLICK this file and choose "Run as administrator".
rem
rem  To undo it later, run STOP-RUNNING-ON-SERVER.bat.
rem --------------------------------------------------------------------------

set "TASKNAME=DeviceRegister"
set "APPDIR=%~dp0device-register"
set "XML=%TEMP%\device-register-task.xml"

echo.
echo   Keep the device register running
echo   ================================
echo.

rem --- administrator? -------------------------------------------------------
net session >nul 2>&1
if errorlevel 1 (
  echo   This needs administrator rights, because it registers something that
  echo   runs when nobody is logged on.
  echo.
  echo   Close this window, RIGHT-CLICK this file, and choose
  echo   "Run as administrator".
  echo.
  pause
  exit /b 1
)
echo   Administrator        ok

rem --- node -----------------------------------------------------------------
set "NODEEXE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODEEXE set "NODEEXE=%%i"
if not defined NODEEXE (
  echo   Node.js is not installed, or not on this computer's PATH.
  echo   Install it from https://nodejs.org/ and run this again.
  echo.
  pause
  exit /b 1
)
echo   Node.js              !NODEEXE!

rem --- is the app there, and set up? ----------------------------------------
if not exist "!APPDIR!\src\server.mjs" (
  echo   Could not find the register next to this file.
  echo   Keep this file in the folder you unzipped.
  echo.
  pause
  exit /b 1
)
if not exist "!APPDIR!\.env" (
  echo.
  echo   The register has not been set up yet, so there is no password.
  echo   Run RUN-ON-WINDOWS.bat once first, then come back to this.
  echo.
  pause
  exit /b 1
)
if not exist "!APPDIR!\node_modules" (
  echo.
  echo   The register has not been installed yet.
  echo   Run RUN-ON-WINDOWS.bat once first, then come back to this.
  echo.
  pause
  exit /b 1
)
echo   The register         found and set up

rem --- OneDrive is a bad home for a live database ---------------------------
echo "!APPDIR!" | findstr /i "onedrive" >nul
if not errorlevel 1 (
  echo.
  echo   ----------------------------------------------------------------
  echo   WARNING: this folder is inside OneDrive.
  echo.
  echo   OneDrive copies files while they change. The register's database
  echo   changes constantly, and a sync running mid-write can corrupt it or
  echo   quietly put back an older copy. A database is not a document.
  echo.
  echo   Move the whole unzipped folder somewhere plain first, for example
  echo   C:\DeviceRegister, then run RUN-ON-WINDOWS.bat once from there and
  echo   come back to this file.
  echo   ----------------------------------------------------------------
  echo.
  set "GO="
  set /p "GO=  Type YES to set it up here anyway, or just press Enter to stop: "
  if /i not "!GO!"=="YES" (
    echo.
    echo   Stopped. Nothing was changed.
    echo.
    pause
    exit /b 1
  )
)

rem --- pin the database, so a service cannot create a second empty one ------
echo.
node "%~dp0extras\pin-database-path.mjs" "!APPDIR!"
if errorlevel 1 (
  echo.
  echo   Stopped. Nothing was registered.
  echo.
  pause
  exit /b 1
)

rem --- which port? ----------------------------------------------------------
set "PORT=3000"
for /f "usebackq tokens=1,* delims==" %%a in ("!APPDIR!\.env") do (
  if /i "%%a"=="PORT" if not "%%b"=="" set "PORT=%%b"
)
set "PORT=!PORT: =!"

rem --- build the task definition -------------------------------------------
node "%~dp0extras\make-task-xml.mjs" "!APPDIR!" "!NODEEXE!" "!XML!"
if errorlevel 1 (
  echo.
  echo   Stopped. Nothing was registered.
  echo.
  pause
  exit /b 1
)

echo.
echo   About to register a task called "!TASKNAME!" that starts the register
echo   with Windows and keeps it running with nobody logged on.
echo.
set "GO="
set /p "GO=  Type YES to go ahead: "
if /i not "!GO!"=="YES" (
  del "!XML!" >nul 2>&1
  echo.
  echo   Stopped. Nothing was changed.
  echo.
  pause
  exit /b 1
)

rem --- stop anything already using that port --------------------------------
schtasks /End /TN "!TASKNAME!" >nul 2>&1

echo.
schtasks /Create /TN "!TASKNAME!" /XML "!XML!" /F
if errorlevel 1 (
  echo.
  echo   Windows refused to register the task. The message above says why.
  echo   Nothing else was changed.
  echo.
  del "!XML!" >nul 2>&1
  pause
  exit /b 1
)
del "!XML!" >nul 2>&1

echo.
echo   Starting it now...
schtasks /Run /TN "!TASKNAME!" >nul 2>&1

rem --- prove it actually works ---------------------------------------------
echo.
node "%~dp0extras\wait-for-app.mjs" !PORT! 30
if errorlevel 1 (
  echo.
  echo   The task was registered but the register is not answering.
  echo   Open Task Scheduler, find "!TASKNAME!", and look at Last Run Result.
  echo   Send that value over if it is not 0x0.
  echo.
  echo   If something else is already using port !PORT! -- another black
  echo   window still open, for instance -- close it and run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo   ----------------------------------------------------------------------
echo   Done. The register now starts with Windows and keeps running when
echo   nobody is logged on.
echo.
echo     Address:   http://localhost:!PORT!
echo     To undo:   STOP-RUNNING-ON-SERVER.bat
echo.
echo   You can close this window, and you can log off the server.
echo   Test it properly: log off, then open the register from another machine.
echo   ----------------------------------------------------------------------
echo.
pause
