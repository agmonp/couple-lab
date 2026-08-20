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

echo Building the local desktop app...
call npm run build
if errorlevel 1 (
  echo.
  echo Couple Lab build failed.
  pause
  exit /b 1
)

echo Opening the Couple Lab Windows app...
echo This launcher does not use http://127.0.0.1:5173.
start "Couple Lab" /D "%~dp0" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."

if errorlevel 1 (
  echo.
  echo Couple Lab could not be opened.
  echo Keep this window open and send us the error shown above.
  pause
  exit /b 1
)

endlocal
