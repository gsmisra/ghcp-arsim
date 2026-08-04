#Requires -Version 5.1
<#
.SYNOPSIS
  Builds and packages the "ARSIM TDS QE GHCP Interface" VS Code extension
  into a single, installable .vsix file.

.DESCRIPTION
  Installs dependencies (if needed), compiles the extension with esbuild,
  and runs `vsce package`. The resulting .vsix is written to
  vscode-arsim-tds-qe-interface/dist-vsix/ and also copied to the repo
  root for convenience.

.EXAMPLE
  ./build-extension.ps1
#>

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$extDir = Join-Path $repoRoot 'vscode-arsim-tds-qe-interface'

if (-not (Test-Path $extDir)) {
    throw "Extension folder not found at $extDir"
}

Write-Host "== ARSIM TDS QE GHCP Interface :: build ==" -ForegroundColor Cyan

Push-Location $extDir
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js is required but was not found on PATH."
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "npm is required but was not found on PATH."
    }

    if (-not (Test-Path (Join-Path $extDir 'node_modules'))) {
        Write-Host "-- Installing dependencies (npm install)" -ForegroundColor Yellow
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
    }

    Write-Host "-- Compiling (esbuild)" -ForegroundColor Yellow
    npm run compile
    if ($LASTEXITCODE -ne 0) { throw "Compile failed." }

    Write-Host "-- Type-checking (tsc --noEmit)" -ForegroundColor Yellow
    npm run lint
    if ($LASTEXITCODE -ne 0) { throw "Type-check failed." }

    $outDir = Join-Path $extDir 'dist-vsix'
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null

    Write-Host "-- Packaging (vsce package)" -ForegroundColor Yellow
    npm run package
    if ($LASTEXITCODE -ne 0) { throw "vsce package failed." }

    $vsix = Get-ChildItem -Path $outDir -Filter '*.vsix' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $vsix) { throw "No .vsix file was produced." }

    Copy-Item $vsix.FullName -Destination $repoRoot -Force
    $rootCopy = Join-Path $repoRoot $vsix.Name

    Write-Host ""
    Write-Host "Build complete." -ForegroundColor Green
    Write-Host "  VSIX: $($vsix.FullName)"
    Write-Host "  Copy: $rootCopy"
    Write-Host ""
    Write-Host "Install with:" -ForegroundColor Cyan
    Write-Host "  code --install-extension `"$rootCopy`""
}
finally {
    Pop-Location
}
