@echo off
setlocal EnableDelayedExpansion
title Device register

rem --------------------------------------------------------------------------
rem  Double-click this to set the register up and start it on this computer.
rem  Safe to run again: it only does the steps that still need doing.
rem  Closing this window stops the register.
rem --------------------------------------------------------------------------

cd /d "%~dp0device-register" 2>nul
if errorlevel 1 (
  echo  Could not find the device-register folder next to this file.
  echo  Keep this file in the folder you unzipped.
  pause
  exit /b 1
)

echo.
echo   Device register
echo   ===============
echo.

rem --- is Node installed? ---------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js is not installed, or not on this computer's PATH.
  echo.
  echo   Install the LTS version from https://nodejs.org/ -- version 22.5 or
  echo   newer -- then close this window and double-click this file again.
  echo.
  pause
  exit /b 1
)

rem --- is it new enough? ----------------------------------------------------
node "%~dp0extras\check-node.mjs"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

rem --- settings -------------------------------------------------------------
if not exist ".env" (
  node "%~dp0extras\setup-env.mjs" "%CD%"
  if errorlevel 1 (
    echo.
    pause
    exit /b 1
  )
) else (
  echo   Settings            ok
)

rem --- dependencies ---------------------------------------------------------
if not exist "node_modules" (
  echo.
  echo   Installing what it needs. This happens once and takes a minute.
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   That did not finish. The usual causes are no internet connection
    echo   or a company proxy blocking the download.
    echo.
    pause
    exit /b 1
  )
) else (
  echo   Dependencies        ok
)

rem --- which port is it on? -------------------------------------------------
set "PORT=3000"
for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
  if /i "%%a"=="PORT" if not "%%b"=="" set "PORT=%%b"
)
set "PORT=!PORT: =!"

rem --- is that port free? -----------------------------------------------
node "%~dp0extras\check-port.mjs" !PORT!
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting on http://localhost:!PORT!
echo   A browser window opens in a moment.
echo.
echo   Leave this window open -- closing it stops the register.
echo   ---------------------------------------------------------------------
echo.

start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:!PORT!'"
node src\server.mjs

echo.
echo   ---------------------------------------------------------------------
echo   The register has stopped.
echo.
pause
