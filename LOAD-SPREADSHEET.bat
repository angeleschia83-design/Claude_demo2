@echo off
setlocal
title Load a spreadsheet into the device register

rem --------------------------------------------------------------------------
rem  Drag a device-holders.xlsx file onto this .bat, or double-click it and
rem  type the path when asked.
rem
rem  This loads an EXPORT the app produced. It is for standing a register up
rem  to look at. Populating a real one is build-data.py + npm run import --
rem  see TESTING-ON-YOUR-SERVER.md.
rem --------------------------------------------------------------------------

echo.
echo   Load a spreadsheet into the device register
echo   ===========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js is not installed. Install it from https://nodejs.org/ first.
  echo.
  pause
  exit /b 1
)

set "BOOK=%~1"
if "%BOOK%"=="" (
  echo   Drag the .xlsx onto this file next time, or type its full path now.
  echo.
  set /p "BOOK=  Path to the spreadsheet: "
)
if "%BOOK%"=="" (
  echo.
  echo   No file given. Nothing was changed.
  echo.
  pause
  exit /b 1
)
set "BOOK=%BOOK:"=%"

if not exist "%BOOK%" (
  echo.
  echo   Could not find: %BOOK%
  echo.
  pause
  exit /b 1
)

echo.
echo   Spreadsheet: %BOOK%
echo   Register:    %~dp0device-register
echo.
echo   This REPLACES the people and devices in that register.
echo   If it already holds anything you care about, stop now and take a copy
echo   of device-register\register.db first.
echo.
set "GO="
set /p "GO=  Type YES to go ahead: "
if /i not "%GO%"=="YES" (
  echo.
  echo   Stopped. Nothing was changed.
  echo.
  pause
  exit /b 1
)

echo.
node "%~dp0extras\load-from-export.mjs" "%BOOK%" "%~dp0device-register" --replace
if errorlevel 1 (
  echo.
  echo   That did not finish. Nothing may have been loaded -- read the message above.
  echo.
  pause
  exit /b 1
)

echo.
echo   Done. Start the register with RUN-ON-WINDOWS.bat and sign in.
echo.
pause
