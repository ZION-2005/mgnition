#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/mgnition-frontend"

cd "$FRONTEND_DIR"

needs_install=0
if [ ! -d "node_modules" ]; then
  needs_install=1
elif ! node -e "import('rolldown').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  needs_install=1
elif ! node -e "import('lightningcss').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
  needs_install=1
fi

if [ "$needs_install" -eq 1 ]; then
  npm install
fi

# Fix common macOS Gatekeeper quarantine issue for native Node bindings.
if command -v xattr >/dev/null 2>&1 && [ -d "node_modules/@rolldown" ]; then
  xattr -dr com.apple.quarantine node_modules/@rolldown 2>/dev/null || true
fi

API_BASE="${VITE_API_BASE:-http://localhost:5001}"
PORT="${FRONTEND_PORT:-5173}"

echo "Starting frontend on http://localhost:$PORT"
echo "Using API base: $API_BASE"

VITE_API_BASE="$API_BASE" npm run dev -- --host 0.0.0.0 --port "$PORT"
