#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

cd "$BACKEND_DIR"

# Recreate a stale/broken venv (common after Python version changes on macOS).
if [ ! -x ".venv/bin/python" ]; then
  rm -rf .venv
  python3 -m venv .venv
fi

source ".venv/bin/activate"

if ! python - <<'PY' >/dev/null 2>&1
import pandas  # noqa: F401
import numpy  # noqa: F401
import sklearn  # noqa: F401
import flask  # noqa: F401
import flask_cors  # noqa: F401
import psycopg2  # noqa: F401
PY
then
  echo "Backend venv is missing/broken. Recreating .venv and reinstalling dependencies..."
  deactivate 2>/dev/null || true
  rm -rf .venv
  python3 -m venv .venv
  source ".venv/bin/activate"
  python -m pip install --upgrade pip setuptools wheel
  pip install -r requirements.txt
fi

if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

MODE="${1:-sqlite}"
if [ "$MODE" = "sqlite" ]; then
  unset DATABASE_URL
fi

export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:5173}"
export PORT="${PORT:-5001}"
# Use single-process mode by default to avoid Flask reloader parent/child
# port issues during local development.
export FLASK_DEBUG="${FLASK_DEBUG:-0}"

if [ "$MODE" = "sqlite" ]; then
  echo "Starting backend in SQLITE mode on port $PORT"
else
  echo "Starting backend in POSTGRES mode on port $PORT"
  if [ -z "${DATABASE_URL:-}" ]; then
    # Convenience fallback for local development with Homebrew Postgres.
    export DATABASE_URL="postgresql://${PGUSER:-$USER}@${PGHOST:-localhost}:${PGPORT:-5433}/${PGDATABASE:-mgnition}"
    echo "DATABASE_URL was not set; using fallback: $DATABASE_URL"
  fi
fi

python app.py
