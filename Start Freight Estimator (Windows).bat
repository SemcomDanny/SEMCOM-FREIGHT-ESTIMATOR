@echo off
REM Double-click this file to set up and start the Freight Estimator.
REM It is safe to run again any time - it only does the setup steps once.

setlocal
cd /d "%~dp0"
title Semcom Freight Estimator

echo.
echo   Semcom Freight Estimator
echo   ========================
echo.

if not exist "package.json" (
  echo   This folder does not contain the application.
  echo.
  echo   You are probably on the empty "main" branch. Open Command Prompt here
  echo   and run:
  echo.
  echo     git checkout claude/freight-estimate-container-tool-ryc7mq
  echo.
  echo   then double-click this file again.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed on this computer.
  echo.
  echo   I will open the download page. Install the version marked "LTS"
  echo   accept all the defaults, then RESTART this computer and
  echo   double-click this file again.
  echo.
  pause
  start https://nodejs.org
  exit /b 1
)

if not exist "node_modules\" (
  echo   First-time setup. This takes a few minutes - leave it running.
  echo.
  call npm install
  if errorlevel 1 goto failed
)

if not exist ".env" (
  echo.
  echo   Creating your admin login...
  echo.
  call npm run setup
  if errorlevel 1 goto failed
  echo.
  echo   ^>^>^> WRITE THE PASSWORD ABOVE DOWN NOW. It is not shown again. ^<^<^<
  echo.
  pause
)

if not exist "web\dist\index.html" (
  echo   Preparing the application...
  call npm run build
  if errorlevel 1 goto failed
)

echo.
call npm start
goto end

:failed
echo.
echo   Something went wrong above. Send the message to whoever set this up.
echo.
pause
exit /b 1

:end
echo.
echo   The Freight Estimator has stopped.
echo.
pause
