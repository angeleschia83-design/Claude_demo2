@echo off
setlocal
title Device register - what is where

rem --------------------------------------------------------------------------
rem  Double-click this if the register looks empty or is missing assets.
rem  It only reads. It changes nothing.
rem
rem  Close the register's own window first, or the database will be in use.
rem --------------------------------------------------------------------------

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. That alone would explain it.
  echo   Install it from https://nodejs.org/ -- version 22.5 or newer.
  echo.
  pause
  exit /b 1
)

node "%~dp0extras\diagnose.mjs" "%~dp0device-register"

echo.
echo   Copy everything above and send it over if it does not look right.
echo.
pause
