@echo off
rem ---------------------------------------------------------------------
rem  Started by the scheduled task, not by a person. Its whole job is to
rem  put the server's output somewhere readable, because a task running
rem  with nobody logged in has no window to print to.
rem ---------------------------------------------------------------------
setlocal
cd /d "%~dp0.."

if not exist logs mkdir logs

rem Keep one old log. Roll at about 5 MB so the file never grows without end.
if exist logs\server.log (
  for %%A in (logs\server.log) do if %%~zA GTR 5000000 (
    if exist logs\server.log.1 del logs\server.log.1
    ren logs\server.log server.log.1
  )
)

echo. >> logs\server.log
echo ===== started %DATE% %TIME% ===== >> logs\server.log

rem NODE_EXE is written in by install-windows.ps1 so the task does not
rem depend on whatever PATH the SYSTEM account happens to have.
if "%NODE_EXE%"=="" set NODE_EXE=node.exe
"%NODE_EXE%" src\server.mjs >> logs\server.log 2>&1

echo ===== stopped %DATE% %TIME% (exit %ERRORLEVEL%) ===== >> logs\server.log
exit /b %ERRORLEVEL%
