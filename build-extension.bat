@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "REPO_ROOT=%SCRIPT_DIR%"
set "EXT_DIR=%REPO_ROOT%\vscode-arsim-tds-qe-interface"

if not exist "%EXT_DIR%" (
    echo Extension folder not found at "%EXT_DIR%"
    exit /b 1
)

echo == ARSIM TDS QE GHCP Interface :: build ==

pushd "%EXT_DIR%" >nul
if errorlevel 1 (
    echo Failed to enter extension directory "%EXT_DIR%"
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is required but was not found on PATH.
    popd >nul
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo npm is required but was not found on PATH.
    popd >nul
    exit /b 1
)

if not exist "%EXT_DIR%\node_modules" (
    echo -- Installing dependencies (npm install)
    call npm install
    if errorlevel 1 (
        echo npm install failed.
        popd >nul
        exit /b 1
    )
)

echo -- Compiling (esbuild)
call npm run compile
if errorlevel 1 (
    echo Compile failed.
    popd >nul
    exit /b 1
)

echo -- Type-checking (tsc --noEmit)
call npm run lint
if errorlevel 1 (
    echo Type-check failed.
    popd >nul
    exit /b 1
)

set "OUT_DIR=%EXT_DIR%\dist-vsix"
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"
if errorlevel 1 (
    echo Failed to create output directory "%OUT_DIR%".
    popd >nul
    exit /b 1
)

echo -- Packaging (vsce package)
call npm run package
if errorlevel 1 (
    echo vsce package failed.
    popd >nul
    exit /b 1
)

set "LATEST_VSIX="
for /f "delims=" %%F in ('dir /b /a:-d /o:-d "%OUT_DIR%\*.vsix" 2^>nul') do (
    if not defined LATEST_VSIX set "LATEST_VSIX=%%F"
)

if not defined LATEST_VSIX (
    echo No .vsix file was produced.
    popd >nul
    exit /b 1
)

set "VSIX_PATH=%OUT_DIR%\%LATEST_VSIX%"
copy /y "%VSIX_PATH%" "%REPO_ROOT%\%LATEST_VSIX%" >nul
if errorlevel 1 (
    echo Failed to copy VSIX to repo root.
    popd >nul
    exit /b 1
)

set "ROOT_COPY=%REPO_ROOT%\%LATEST_VSIX%"

echo.
echo Build complete.
echo   VSIX: %VSIX_PATH%
echo   Copy: %ROOT_COPY%
echo.
echo Install with:
echo   code --install-extension "%ROOT_COPY%"

popd >nul
exit /b 0
