@echo off
cd /d "%~dp0"

set "PORT=5173"
set "URL=http://127.0.0.1:%PORT%"

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo Couple Lab needs Node.js, which is not installed on this computer.
  echo.
  echo   1. Go to https://nodejs.org
  echo   2. Download the version marked LTS and install it
  echo   3. Run this file again
  echo.
  pause
  exit /b 1
)

rem Already running from an earlier launch? Just open the window again.
call :IsServerUp
if not errorlevel 1 (
  echo Couple Lab is already running.
  start "" "%URL%"
  exit /b 0
)

if not exist node_modules (
  echo.
  echo First run: setting up Couple Lab. This takes a few minutes,
  echo and only has to happen once.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo Setup failed. Check your internet connection, then run this file again.
    pause
    exit /b 1
  )
)

echo Starting Couple Lab...
start "Couple Lab Server" /min cmd /c "cd /d ""%~dp0"" && npm run dev -- --port %PORT%"

rem Wait until the server answers instead of guessing how long this machine needs.
call :WaitForServer
if errorlevel 1 (
  echo.
  echo Couple Lab did not finish starting.
  echo Open the minimised "Couple Lab Server" window to see why.
  pause
  exit /b 1
)

start "" "%URL%"
exit /b 0

:IsServerUp
powershell -NoProfile -Command "try { $c = [Net.Sockets.TcpClient]::new(); $c.Connect('127.0.0.1', %PORT%); $c.Close(); exit 0 } catch { exit 1 }"
exit /b %errorlevel%

:WaitForServer
powershell -NoProfile -Command "$deadline = (Get-Date).AddSeconds(120); while ((Get-Date) -lt $deadline) { try { $c = [Net.Sockets.TcpClient]::new(); $c.Connect('127.0.0.1', %PORT%); $c.Close(); exit 0 } catch { Start-Sleep -Milliseconds 400 } }; exit 1"
exit /b %errorlevel%
