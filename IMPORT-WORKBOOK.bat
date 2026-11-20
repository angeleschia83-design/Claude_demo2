@echo off
setlocal EnableDelayedExpansion
title Bring a new workbook into the device register

rem --------------------------------------------------------------------------
rem  Put the asset workbook and HR's employee list in this folder, then
rem  double-click this file. (Dragging both onto it works too.)
rem  The .xlsx with "Employee" in its name is taken as the HR list; the other
rem  one is the workbook (one with "cleaned" in its name is preferred).
rem
rem  It backs up the register first, then turns the workbook into the two files
rem  the register reads, then loads them. Nothing in the register changes yet:
rem  every difference waits under Import, From the workbook, for an admin to
rem  tick and apply. Corrections made in the app are never overwritten.
rem
rem  Needs Python 3 with openpyxl on this machine, as well as Node.js.
rem --------------------------------------------------------------------------

echo.
echo   Bring a new workbook into the device register
echo   =============================================
echo.

set "APP=%~dp0device-register"
if not exist "%APP%\scripts\build-data.py" (
  echo   This file has to sit beside the device-register folder.
  echo   Put it in the same folder as RUN-ON-WINDOWS.bat and try again.
  goto :fail
)

where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js is not installed. Install it from https://nodejs.org/ first.
  goto :fail
)

rem ---- find Python -----------------------------------------------------------
set "PY="
call py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY call python --version >nul 2>&1 && set "PY=python"
if not defined PY call python3 --version >nul 2>&1 && set "PY=python3"
if not defined PY (
  echo   Python is not installed on this machine.
  echo.
  echo   Install Python 3 from https://www.python.org/downloads/ and tick
  echo   "Add python.exe to PATH" on the first screen of the installer.
  echo   Then run this again.
  goto :fail
)

call %PY% -c "import openpyxl" >nul 2>&1
if errorlevel 1 (
  echo   Python needs one extra part, openpyxl, to read Excel files. Installing it...
  echo.
  call %PY% -m pip install --user openpyxl
  call %PY% -c "import openpyxl" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo   openpyxl could not be installed. Ask IT to run:  pip install openpyxl
    goto :fail
  )
)

rem ---- find the spreadsheets: dragged on, or sitting beside this file ---------
set "HERE=%~dp0"
set "BOOK="
set "HR="
set "CLEAN="
set /a NB=0, NH=0, NC=0
if not "%~1"=="" (
  for %%F in (%*) do call :consider "%%~fF"
) else (
  for %%F in ("%~dp0*.xlsx") do call :consider "%%~fF"
)

if !NB! gtr 1 if !NC! equ 1 (
  set "BOOK=!CLEAN!"
  set /a NB=1
)
if !NB! equ 0 (
  echo   No asset workbook was found. Put the asset workbook and HR's
  echo   employee list in this folder, then double-click this file again:
  echo     !HERE!
  goto :fail
)
if !NB! gtr 1 (
  echo   There is more than one workbook in this folder, so it cannot tell
  echo   which one to use:
  for %%F in ("!HERE!*.xlsx") do (
    set "X=%%~nxF"
    if not "!X:~0,2!"=="~$" echo     %%~nxF
  )
  echo.
  echo   Leave just one asset workbook and one employee list here, then try again.
  goto :fail
)
if !NH! gtr 1 (
  echo   There is more than one employee list in this folder. Leave just the one
  echo   to use, then try again.
  goto :fail
)
if !NH! equ 0 (
  echo   No HR employee list was found, the file with "Employee" in its name.
  echo   Without it, Sales and Head office are guessed from job titles, and
  echo   nobody is marked resigned from HR's list.
)

echo.
echo   Asset workbook:  !BOOK!
if defined HR (echo   HR list:         !HR!) else (echo   HR list:         none)
echo   Register:        %APP%
echo.
echo   The register is backed up first. Nothing in it changes until an admin
echo   ticks the differences under Import, From the workbook.
echo.
set "GO="
set /p "GO=  Type YES to go ahead: "
if /i not "!GO!"=="YES" (
  echo.
  echo   Stopped. Nothing was changed.
  goto :end
)

rem ---- 1. back up ------------------------------------------------------------
echo.
echo   1 of 3  Backing up the register
node "%~dp0extras\backup-database.mjs" "%APP%"
if errorlevel 1 (
  echo   The backup did not finish, so nothing else was done.
  goto :fail
)

rem ---- 2. workbook to the two files the register reads -----------------------
echo.
echo   2 of 3  Reading the workbook
if defined HR (
  call %PY% "%APP%\scripts\build-data.py" "!BOOK!" "%APP%\data" "!HR!"
) else (
  call %PY% "%APP%\scripts\build-data.py" "!BOOK!" "%APP%\data"
)
if errorlevel 1 (
  echo.
  echo   The workbook could not be read. The register was not touched.
  echo   Read the message above: it usually names the sheet or column it missed.
  goto :fail
)

rem ---- 3. load them ----------------------------------------------------------
echo.
echo   3 of 3  Loading into the register
pushd "%APP%"
call npm run import
set "RESULT=!errorlevel!"
popd
if not "!RESULT!"=="0" (
  echo.
  echo   The load did not finish. Read the message above. Your backup is beside
  echo   register.db, named register-backup- and today's date.
  goto :fail
)

echo.
echo   Done. Open the register, sign in as admin, and go to
echo   Import, From the workbook, to look through the differences and apply them.
echo.
goto :end

:fail
echo.
pause
exit /b 1

:end
pause
exit /b 0

rem ---- one spreadsheet: the HR list, or a workbook --------------------------
:consider
set "N=%~nx1"
rem Excel's own lock files, made while a workbook is open.
if "!N:~0,2!"=="~$" goto :eof
echo %~nx1| findstr /i "employee" >nul
if not errorlevel 1 (
  set /a NH+=1
  set "HR=%~f1"
  goto :eof
)
set /a NB+=1
set "BOOK=%~f1"
echo %~nx1| findstr /i "cleaned" >nul
if not errorlevel 1 (
  set /a NC+=1
  set "CLEAN=%~f1"
)
goto :eof
