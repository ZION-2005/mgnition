#!/usr/bin/env bash
set -euo pipefail

BACKEND_PORT="${BACKEND_PORT:-5001}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

echo "Checking backend: http://127.0.0.1:${BACKEND_PORT}/health"
if curl -sS "http://127.0.0.1:${BACKEND_PORT}/health"; then
  echo
  echo "Backend is reachable."
else
  echo
  echo "Backend is not reachable."
fi

echo "Checking frontend: http://127.0.0.1:${FRONTEND_PORT}"
if curl -sS -I "http://127.0.0.1:${FRONTEND_PORT}" | head -n 1; then
  echo "Frontend is reachable."
else
  echo "Frontend is not reachable."
fi
