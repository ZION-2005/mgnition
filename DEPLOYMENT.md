# Production Deployment Guide (Docker)

This project can be deployed as a full stack with:

- `frontend` (React + Vite build served by Nginx)
- `backend` (Flask API via Gunicorn)
- `db` (PostgreSQL)

Frontend and backend are served from the same domain using an `/api` reverse proxy.

## 1. Prerequisites

- Docker Desktop (or Docker Engine + Compose plugin)
- A machine/VPS with ports `80` (and `443` if you later add TLS)

## 2. Configure environment

From project root:

```bash
cp .env.production.example .env.production
```

Then edit `.env.production`:

- set a strong `POSTGRES_PASSWORD`
- set `FRONTEND_URL` to your public domain (used in email links)
- set SMTP values if you need password reset/booking emails
- set `VITE_GOOGLE_MAPS_API_KEY` if you need the Google map widget

## 3. Deploy

```bash
chmod +x scripts/deploy_prod.sh
scripts/deploy_prod.sh
```

Or explicitly pass env file:

```bash
scripts/deploy_prod.sh .env.production
```

## 4. Verify

```bash
curl -sS http://127.0.0.1/api/health
```

If you mapped another port:

```bash
curl -sS http://127.0.0.1:<WEB_PORT>/api/health
```

Open the site:

```text
http://<server-ip-or-domain>
```

## 5. Operations

Show service status:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

View logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f
```

Restart:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart
```

Stop:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml down
```

Stop and remove DB volume (destructive):

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml down -v
```

## 6. Feature smoke checklist

After deployment, validate:

1. Signup/login/logout
2. Quiz -> recommendation top 3
3. Save and compare
4. Showroom map rendering (if Google Maps key is set)
5. Booking submission
6. Admin login and booking status update
7. Booking approval email delivery (if SMTP is configured)
8. Password reset email flow (if SMTP is configured)
