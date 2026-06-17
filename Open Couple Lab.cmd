@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js / npm were not found.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing app dependencies. This may take a minute...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Checking Couple Lab server...
powershell -NoProfile -Command "try { $client = [Net.Sockets.TcpClient]::new(); $client.Connect('127.0.0.1', 5173); $client.Close(); exit 0 } catch { exit 1 }"

if errorlevel 1 (
  echo Starting Couple Lab...
  start "Couple Lab Server" /min cmd /k "cd /d ""%~dp0"" && npm run dev -- --port 5173"
  timeout /t 3 /nobreak >nul
) else (
  echo Couple Lab is already running.
)

start "" "http://127.0.0.1:5173"

endlocal
