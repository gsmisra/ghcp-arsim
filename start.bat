@echo off
setlocal
cd /d %~dp0

for /f "tokens=1,* delims==" %%A in (app_config.properties) do (
  if /I "%%A"=="APP_BASE_URL" set APP_BASE_URL=%%B
)

if "%APP_BASE_URL%"=="" set APP_BASE_URL=http://localhost:5050

set GHCP_BRIDGE_EXTENSION_DIR=%cd%\vscode-ghcp-bridge-extension
set GHCP_BRIDGE_URL=http://127.0.0.1:8765

echo Running startup pre-checks...
python startup_check.py >nul 2>nul
if %errorlevel% neq 0 (
  echo Missing dependencies detected. Installing from requirements.txt ...
  python -m pip install -r requirements.txt
  if %errorlevel% neq 0 (
    echo.
    echo Dependency installation failed. Resolve installation errors and rerun start.bat.
    exit /b 1
  )

  echo Re-validating dependencies...
  python startup_check.py
  if %errorlevel% neq 0 (
    echo.
    echo Startup validation still failed after installation.
    exit /b 1
  )
) else (
  echo Dependencies already satisfied. Skipping installation.
)

where code >nul 2>nul
if %errorlevel%==0 (
  echo Launching GHCP bridge extension host...
  start "GHCP Bridge" code --new-window --extensionDevelopmentPath "%GHCP_BRIDGE_EXTENSION_DIR%"
) else (
  echo VS Code CLI not found. Install the 'code' command to auto-launch the GHCP bridge extension host.
)

echo Waiting for GHCP bridge at %GHCP_BRIDGE_URL% ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "for ($i=0; $i -lt 30; $i++) { try { $response = Invoke-RestMethod -Uri '%GHCP_BRIDGE_URL%/health' -TimeoutSec 2; if ($response.status -eq 'ok') { exit 0 } } catch { }; Start-Sleep -Seconds 1 }; exit 1"

if %errorlevel%==0 (
  echo GHCP bridge is ready.
) else (
  echo GHCP bridge did not respond yet. The UI will keep retrying automatically.
)

echo Launching ARSIM UI on %APP_BASE_URL% ...
start "" "%APP_BASE_URL%"
python web_app.py

if %errorlevel% neq 0 (
  echo.
  echo UI runtime failed. Check logs in output\platform.log
)

endlocal
