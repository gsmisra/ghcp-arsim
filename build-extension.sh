#!/usr/bin/env bash
# Builds and packages the "ARSIM TDS QE GHCP Interface" VS Code extension
# into a single, installable .vsix file. macOS/Linux/Git-Bash counterpart
# to build-extension.ps1.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$REPO_ROOT/vscode-arsim-tds-qe-interface"

if [ ! -d "$EXT_DIR" ]; then
  echo "Extension folder not found at $EXT_DIR" >&2
  exit 1
fi

echo "== ARSIM TDS QE GHCP Interface :: build =="

command -v node >/dev/null 2>&1 || { echo "Node.js is required but was not found on PATH." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required but was not found on PATH." >&2; exit 1; }

cd "$EXT_DIR"

if [ ! -d "node_modules" ]; then
  echo "-- Installing dependencies (npm install)"
  npm install
fi

echo "-- Compiling (esbuild)"
npm run compile

echo "-- Type-checking (tsc --noEmit)"
npm run lint

mkdir -p dist-vsix

echo "-- Packaging (vsce package)"
npm run package

VSIX_FILE=$(ls -t dist-vsix/*.vsix | head -n1)
cp "$VSIX_FILE" "$REPO_ROOT/"

echo ""
echo "Build complete."
echo "  VSIX: $EXT_DIR/$VSIX_FILE"
echo "  Copy: $REPO_ROOT/$(basename "$VSIX_FILE")"
echo ""
echo "Install with:"
echo "  code --install-extension \"$REPO_ROOT/$(basename "$VSIX_FILE")\""
