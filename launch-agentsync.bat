@echo off
setlocal

title AgentSync Launcher
cd /d "%~dp0"

echo.
echo ========================================
echo   AgentSync Launcher
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  echo Install Node.js 22.x, then run this file again.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found on PATH.
  echo Install Node.js 22.x, then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency installation failed.
    pause
    exit /b 1
  )
  echo.
)

if not exist "dist\server\index.js" (
  echo Building the server and web app for the first launch...
  call npm run build
  if errorlevel 1 (
    echo.
    echo Build failed.
    pause
    exit /b 1
  )
  echo.
)

echo Starting AgentSync...
echo Frontend: http://localhost:5173/
echo Backend:  http://localhost:3000/
echo.
echo Leave this window open while using the app.
echo Press Ctrl+C to stop AgentSync.
echo.

start "" "http://localhost:5173/"
call npm run dev

echo.
echo AgentSync has stopped.
pause
