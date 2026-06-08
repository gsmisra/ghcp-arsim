@echo off
setlocal
cd /d %~dp0

for /f "tokens=1,* delims==" %%A in (app_config.properties) do (
  if /I "%%A"=="APP_BASE_URL" set APP_BASE_URL=%%B
)

if "%APP_BASE_URL%"=="" set APP_BASE_URL=http://localhost:5050

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

echo Launching ARSIM UI on %APP_BASE_URL% ...
start "" "%APP_BASE_URL%"
python web_app.py

if %errorlevel% neq 0 (
  echo.
  echo UI runtime failed. Check logs in output\platform.log
)

endlocal
