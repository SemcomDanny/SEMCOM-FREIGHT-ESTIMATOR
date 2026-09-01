@echo off
REM Double-click to fetch the latest version and start it.
REM Stop the tool first if it is running (Ctrl+C in its window).

setlocal
cd /d "%~dp0"
title Semcom Freight Estimator - update

echo.
echo   Updating the Freight Estimator
echo   ==============================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo   Git is not installed, so this cannot fetch updates.
  echo   Download it from https://git-scm.com and try again.
  echo.
  pause
  exit /b 1
)

REM A failed install can leave package-lock.json modified, which blocks the
REM pull. It is a generated file, so the published one always wins.
git checkout -- package-lock.json >nul 2>nul

echo   Fetching the latest version...
call git pull
if errorlevel 1 (
  echo.
  echo   Could not fetch updates. If it mentions local changes, send the
  echo   message above to whoever set this up.
  echo.
  pause
  exit /b 1
)

echo.
echo   Installing any new components...
call npm install
if errorlevel 1 goto failed

echo.
echo   Rebuilding...
call npm run build
if errorlevel 1 goto failed

echo.
echo   Up to date. Starting...
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
