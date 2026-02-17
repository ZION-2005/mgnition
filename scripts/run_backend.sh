#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

cd "$BACKEND_DIR"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

source ".venv/bin/activate"

if ! python - <<'PY' >/dev/null 2>&1
import pandas  # noqa: F401
import numpy  # noqa: F401
import sklearn  # noqa: F401
PY
then
  echo "Installing backend dependencies from requirements.txt..."
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
export FLASK_DEBUG="${FLASK_DEBUG:-1}"

if [ "$MODE" = "sqlite" ]; then
  echo "Starting backend in SQLITE mode on port $PORT"
else
  echo "Starting backend in POSTGRES mode on port $PORT"
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL is not set. Pass 'sqlite' mode or set DATABASE_URL."
    exit 1
  fi
fi

python app.py
