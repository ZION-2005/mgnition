#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env.production}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing env file: $ENV_FILE"
  echo "Create it from $ROOT_DIR/.env.production.example first."
  exit 1
fi

cd "$ROOT_DIR"

echo "Deploying production stack with env file: $ENV_FILE"
docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml up -d --build

WEB_PORT="$(awk -F= '/^WEB_PORT=/{print $2}' "$ENV_FILE" | tr -d '[:space:]' || true)"
WEB_PORT="${WEB_PORT:-80}"

echo "Waiting for backend health..."
for i in {1..30}; do
  if curl -fsS "http://127.0.0.1:${WEB_PORT}/api/health" >/dev/null; then
    echo "Backend is healthy."
    break
  fi
  sleep 2
done

echo
echo "Frontend URL: http://127.0.0.1:${WEB_PORT}"
echo "Backend health URL: http://127.0.0.1:${WEB_PORT}/api/health"
echo
echo "Current containers:"
docker compose --env-file "$ENV_FILE" -f docker-compose.prod.yml ps
