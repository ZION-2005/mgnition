#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/mgnition-frontend"

cd "$FRONTEND_DIR"

if [ ! -d "node_modules" ]; then
  npm install
fi

API_BASE="${VITE_API_BASE:-http://localhost:5001}"
PORT="${FRONTEND_PORT:-5173}"

echo "Starting frontend on http://localhost:$PORT"
echo "Using API base: $API_BASE"

VITE_API_BASE="$API_BASE" npm run dev -- --host 0.0.0.0 --port "$PORT"
