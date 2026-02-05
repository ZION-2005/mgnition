# MGNITION Deployment (GitHub + Render + Vercel)

## 1) Push to GitHub
```bash
git add .
git commit -m "Prepare production deployment"
git push origin main
```

## 2) Deploy backend (Render)
- In Render, click **New +** -> **Blueprint**.
- Select your GitHub repo.
- Render will read `render.yaml` and create:
  - `mgnition-backend` web service
  - persistent disk mounted at `/var/data`
- After deploy, open:
  - `https://<your-render-backend>/ml/status`

### Important Render env vars
- Update `ALLOWED_ORIGINS` to your real frontend URL later (Vercel URL).
- Optional SMTP vars for password reset email:
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `PASSWORD_RESET_BASE_URL`

## 3) Deploy frontend (Vercel)
- In Vercel, click **Add New Project** and import this GitHub repo.
- Set **Root Directory** to `mgnition-frontend`.
- Build command: `npm run build`
- Output directory: `dist`
- Add env var:
  - `VITE_API_BASE=https://<your-render-backend>`
- Deploy.

## 4) Connect CORS
- Copy the final Vercel URL.
- In Render service settings, set:
  - `ALLOWED_ORIGINS=https://<your-vercel-url>`
- Redeploy backend.

## 5) Ongoing updates
- Make changes locally, commit, and push.
- Render + Vercel auto-redeploy from GitHub.
- Your URL stays the same for users.
