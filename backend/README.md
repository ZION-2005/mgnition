# MGNITION Backend (Flask + SQLite + Learning Recommender)

## Run

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Base URL: `http://localhost:5001`

## Auth + User Data

- `POST /auth/signup`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /me`
- `PUT /profile` (stores quiz answers per user)

## Saved Cars

- `GET /saved-models`
- `POST /saved-models`
- `DELETE /saved-models/<variant_key>`

Only saved cars are shown in user Saved Results.

## Recommendations

- `POST /recommend`

Variant-level recommendations are generated from `backend/data/modelVariants.json`.

## Learning Endpoints

- `GET /ml/status`
- `POST /ml/retrain`

The model learns from real user behavior using:
- recommendation impressions
- save events (positive feedback)

Data is persisted in `backend/mgnition.db` and model artifact is saved to `backend/models/recommender.joblib`.
