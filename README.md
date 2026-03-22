# Mgnition

Local setup for macOS with local Postgres.

## 1. Start Postgres

If you use Homebrew Postgres:

```bash
brew services start postgresql@16
```

Make sure your local DB exists:

```bash
/opt/homebrew/opt/postgresql@16/bin/psql -p 5433 -U "$USER" -d postgres -c "CREATE DATABASE mgnition;" || true
```

## 2. Run backend (Postgres mode)

From project root:

```bash
DATABASE_URL="postgresql://$USER@localhost:5433/mgnition" PORT=5001 scripts/run_backend.sh postgres
```

Notes:
- `scripts/run_backend.sh` now auto-recreates a broken `backend/.venv`.
- If `DATABASE_URL` is omitted, it falls back to: `postgresql://$USER@localhost:5433/mgnition`.

## 3. Run frontend

In another terminal:

```bash
VITE_API_BASE="http://localhost:5001" FRONTEND_PORT=5173 scripts/run_frontend.sh
```

Notes:
- The script auto-reinstalls frontend deps when the native `rolldown` binding is missing/broken.
- On macOS, it also removes quarantine flags from `node_modules/@rolldown` when needed.
- To enable Google Maps API on the Showrooms map page, set:
  - `VITE_GOOGLE_MAPS_API_KEY=your_key`
  - Example:

```bash
VITE_API_BASE="http://localhost:5001" VITE_GOOGLE_MAPS_API_KEY="YOUR_KEY" FRONTEND_PORT=5173 scripts/run_frontend.sh
```

## 4. Smoke check

```bash
BACKEND_PORT=5001 FRONTEND_PORT=5173 scripts/check_local.sh
```

## 5. Production deployment (Docker)

See:

- `DEPLOYMENT.md`
- `docker-compose.prod.yml`

Quick start:

```bash
cp .env.production.example .env.production
scripts/deploy_prod.sh
```
