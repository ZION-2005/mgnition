import json
import os
import secrets
import smtplib
import sqlite3
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from functools import wraps
from pathlib import Path

from flask import Flask, g, jsonify, request
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash

try:
    import psycopg2
    from psycopg2.extras import DictCursor

    PSYCOPG2_AVAILABLE = True
except Exception:
    PSYCOPG2_AVAILABLE = False

try:
    import joblib
    from sklearn.feature_extraction import DictVectorizer
    from sklearn.linear_model import SGDClassifier

    SKLEARN_AVAILABLE = True
except Exception:
    SKLEARN_AVAILABLE = False

COSINE_IMPORT_ERROR = ""
try:
    import pandas as pd

    from cosine_recommender import FEATURE_ORDER as COSINE_FEATURE_ORDER
    from cosine_recommender import score_cars_with_cosine

    COSINE_AVAILABLE = True
except Exception as e:
    COSINE_AVAILABLE = False
    COSINE_IMPORT_ERROR = str(e)
    COSINE_FEATURE_ORDER = []

app = Flask(__name__)
allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "*").strip()
allowed_origins = "*" if allowed_origins_env == "*" else [o.strip() for o in allowed_origins_env.split(",") if o.strip()]
CORS(app, resources={r"/*": {"origins": allowed_origins}}, allow_headers=["Content-Type", "Authorization"])

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("MGNITION_DB_PATH", str(BASE_DIR / "mgnition.db")))
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
USE_POSTGRES = DATABASE_URL.startswith("postgres://") or DATABASE_URL.startswith("postgresql://")
VARIANT_DATA_PATH = BASE_DIR / "data" / "modelVariants.json"
MODEL_PATH = BASE_DIR / "models" / "recommender.joblib"


def utc_now():
    return datetime.utcnow()


def utc_now_iso():
    return utc_now().isoformat(timespec="seconds") + "Z"


def parse_iso(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", ""))
    except Exception:
        return None


def safe_float(v, default=0.0):
    try:
        return float(v)
    except Exception:
        return default


def clean_str(v):
    return "" if v is None else str(v).strip()


def normalize_text(v):
    return clean_str(v).lower().replace("  ", " ").strip()


def normalize_color_label(raw):
    return (
        clean_str(raw)
        .replace("_", " ")
        .replace("-", " ")
        .replace("Color", "")
        .replace("color", "")
        .replace("Image", "")
        .replace("image", "")
        .replace("URL", "")
        .replace("url", "")
        .replace("Img", "")
        .replace("img", "")
        .strip()
    )


def looks_like_image_url(v):
    s = clean_str(v).lower()
    return s.startswith("http://") or s.startswith("https://")


def extract_color_images(row):
    if isinstance(row.get("Color_Images"), dict):
        return row.get("Color_Images") or {}
    if isinstance(row.get("color_images"), dict):
        return row.get("color_images") or {}

    out = {}
    for key, val in row.items():
        value = clean_str(val)
        if not value or not looks_like_image_url(value):
            continue
        k = clean_str(key).lower()
        has_color_signal = "color" in k or any(
            c in k for c in ["white", "black", "red", "blue", "silver", "grey", "gray", "green", "orange", "yellow", "beige", "brown", "pink", "purple"]
        )
        if not has_color_signal:
            continue
        label = normalize_color_label(key)
        if label:
            out[label] = value

    generic_color = clean_str(row.get("Color") or row.get("color"))
    generic_image = clean_str(row.get("Color_Image_URL") or row.get("color_image_url"))
    if generic_color and generic_image and looks_like_image_url(generic_image):
        out[generic_color] = generic_image
    return out


def fmt_price(v):
    n = int(safe_float(v, 0))
    return f"{n:,} THB" if n else "N/A"


def variant_key_from_values(model, variant, year):
    return f"{clean_str(model)}|{clean_str(variant)}|{clean_str(year)}"


def variant_key(row):
    return variant_key_from_values(row.get("Model"), row.get("Variant"), row.get("Year"))


class PgCompatConnection:
    def __init__(self, conn):
        self._conn = conn

    @staticmethod
    def _rewrite_query(query):
        return query.replace("?", "%s")

    def execute(self, query, params=None):
        cur = self._conn.cursor(cursor_factory=DictCursor)
        cur.execute(self._rewrite_query(query), params or ())
        return cur

    def executescript(self, script):
        cur = self._conn.cursor()
        for stmt in [s.strip() for s in script.split(";") if s.strip()]:
            cur.execute(stmt)
        cur.close()

    def commit(self):
        self._conn.commit()

    def close(self):
        self._conn.close()


def create_db_connection():
    if USE_POSTGRES:
        if not PSYCOPG2_AVAILABLE:
            raise RuntimeError("DATABASE_URL is set, but psycopg2 is not installed.")
        conn = psycopg2.connect(DATABASE_URL, cursor_factory=DictCursor)
        return PgCompatConnection(conn)

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_db():
    if "db" not in g:
        g.db = create_db_connection()
    return g.db


@app.teardown_appcontext
def close_db(_error):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def column_exists(db, table, col):
    if USE_POSTGRES:
        row = db.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ? AND column_name = ?
            LIMIT 1
            """,
            (table, col),
        ).fetchone()
        return row is not None

    cols = db.execute(f"PRAGMA table_info({table})").fetchall()
    return any(c[1] == col for c in cols)


def ensure_pg_id_sequence_default(db, table):
    if not USE_POSTGRES:
        return
    seq_name = f"{table}_id_seq"
    exists = db.execute(
        """
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'S' AND c.relname = ?
        LIMIT 1
        """,
        (seq_name,),
    ).fetchone()
    if not exists:
        db.execute(f"CREATE SEQUENCE {seq_name}")
    db.execute(f"ALTER TABLE {table} ALTER COLUMN id SET DEFAULT nextval('{seq_name}')")
    db.execute(f"SELECT setval('{seq_name}', COALESCE((SELECT MAX(id) FROM {table}), 0) + 1, false)")


def init_db():
    db = create_db_connection()

    if USE_POSTGRES:
        statements = [
            """
            CREATE TABLE IF NOT EXISTS users (
                id BIGSERIAL PRIMARY KEY,
                full_name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                phone TEXT,
                created_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS profiles (
                user_id BIGINT PRIMARY KEY REFERENCES users(id),
                quiz_answers TEXT NOT NULL DEFAULT '{}',
                updated_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS saved_variants (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(id),
                variant_key TEXT NOT NULL,
                model TEXT NOT NULL,
                variant TEXT,
                year TEXT,
                price TEXT,
                fuel TEXT,
                seats TEXT,
                body_type TEXT,
                image_url TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, variant_key)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS recommendation_impressions (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT,
                variant_key TEXT NOT NULL,
                served_at TEXT NOT NULL,
                rank_pos INTEGER,
                rule_score REAL,
                ml_score REAL,
                final_score REAL,
                answers_json TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS car_impressions (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT,
                variant_key TEXT NOT NULL,
                served_at TEXT NOT NULL,
                source TEXT,
                answers_json TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS user_feedback (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(id),
                variant_key TEXT NOT NULL,
                event_type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                payload_json TEXT
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                token TEXT PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(id),
                expires_at TEXT NOT NULL,
                used_at TEXT,
                created_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS promotions (
                id BIGSERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                price_text TEXT,
                badge_text TEXT,
                image_url TEXT,
                model_name TEXT,
                variant_name TEXT,
                variant_key TEXT,
                start_date TEXT,
                end_date TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                created_by BIGINT,
                created_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS bookings (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(id),
                user_name TEXT NOT NULL,
                user_email TEXT NOT NULL,
                user_phone TEXT,
                showroom_id TEXT,
                showroom_name TEXT NOT NULL,
                showroom_address TEXT,
                province TEXT,
                model TEXT NOT NULL,
                variant TEXT,
                variant_key TEXT,
                notes TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS admin_models (
                id BIGSERIAL PRIMARY KEY,
                model TEXT NOT NULL,
                variant TEXT,
                year TEXT,
                price_thb REAL,
                fuel_type TEXT,
                seats INTEGER,
                body_type TEXT,
                horsepower_hp REAL,
                torque_nm REAL,
                range_km REAL,
                cargo_liters REAL,
                image_url TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                created_by BIGINT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS best_sellers (
                id BIGSERIAL PRIMARY KEY,
                model_name TEXT NOT NULL,
                variant_name TEXT,
                variant_key TEXT,
                rank INTEGER NOT NULL DEFAULT 1,
                active INTEGER NOT NULL DEFAULT 1,
                created_by BIGINT,
                created_at TEXT NOT NULL
            )
            """,
        ]
        for stmt in statements:
            db.execute(stmt)
    else:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                phone TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS profiles (
                user_id INTEGER PRIMARY KEY,
                quiz_answers TEXT NOT NULL DEFAULT '{}',
                updated_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS saved_variants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                variant_key TEXT NOT NULL,
                model TEXT NOT NULL,
                variant TEXT,
                year TEXT,
                price TEXT,
                fuel TEXT,
                seats TEXT,
                body_type TEXT,
                image_url TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, variant_key),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS recommendation_impressions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                variant_key TEXT NOT NULL,
                served_at TEXT NOT NULL,
                rank_pos INTEGER,
                rule_score REAL,
                ml_score REAL,
                final_score REAL,
                answers_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS car_impressions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                variant_key TEXT NOT NULL,
                served_at TEXT NOT NULL,
                source TEXT,
                answers_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                variant_key TEXT NOT NULL,
                event_type TEXT NOT NULL,
                created_at TEXT NOT NULL,
                payload_json TEXT
            );

            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                expires_at TEXT NOT NULL,
                used_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS promotions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                price_text TEXT,
                badge_text TEXT,
                image_url TEXT,
                model_name TEXT,
                variant_name TEXT,
                variant_key TEXT,
                start_date TEXT,
                end_date TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                created_by INTEGER,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                user_name TEXT NOT NULL,
                user_email TEXT NOT NULL,
                user_phone TEXT,
                showroom_id TEXT,
                showroom_name TEXT NOT NULL,
                showroom_address TEXT,
                province TEXT,
                model TEXT NOT NULL,
                variant TEXT,
                variant_key TEXT,
                notes TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS admin_models (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                model TEXT NOT NULL,
                variant TEXT,
                year TEXT,
                price_thb REAL,
                fuel_type TEXT,
                seats INTEGER,
                body_type TEXT,
                horsepower_hp REAL,
                torque_nm REAL,
                range_km REAL,
                cargo_liters REAL,
                image_url TEXT,
                active INTEGER NOT NULL DEFAULT 1,
                created_by INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS best_sellers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                model_name TEXT NOT NULL,
                variant_name TEXT,
                variant_key TEXT,
                rank INTEGER NOT NULL DEFAULT 1,
                active INTEGER NOT NULL DEFAULT 1,
                created_by INTEGER,
                created_at TEXT NOT NULL
            );
            """
        )

    if not column_exists(db, "users", "is_admin"):
        db.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
    if not column_exists(db, "promotions", "model_name"):
        db.execute("ALTER TABLE promotions ADD COLUMN model_name TEXT")
    if not column_exists(db, "promotions", "variant_name"):
        db.execute("ALTER TABLE promotions ADD COLUMN variant_name TEXT")
    if not column_exists(db, "promotions", "variant_key"):
        db.execute("ALTER TABLE promotions ADD COLUMN variant_key TEXT")

    if USE_POSTGRES:
        ensure_pg_id_sequence_default(db, "promotions")
        ensure_pg_id_sequence_default(db, "admin_models")
        ensure_pg_id_sequence_default(db, "bookings")
        ensure_pg_id_sequence_default(db, "best_sellers")

    admin_count = db.execute("SELECT COUNT(*) FROM users WHERE is_admin = 1").fetchone()[0]
    if admin_count == 0:
        first_user = db.execute("SELECT id FROM users ORDER BY id ASC LIMIT 1").fetchone()
        if first_user:
            db.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (first_user[0],))

    db.commit()
    db.close()


def get_token_from_header():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


def get_user_by_token(token):
    if not token:
        return None
    db = get_db()
    row = db.execute(
        """
        SELECT u.* FROM users u
        JOIN sessions s ON s.user_id = u.id
        WHERE s.token = ?
        """,
        (token,),
    ).fetchone()
    return row


def auth_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token = get_token_from_header()
        user = get_user_by_token(token)
        if not user:
            return jsonify({"error": "Unauthorized"}), 401
        g.current_user = user
        g.current_token = token
        return fn(*args, **kwargs)

    return wrapper


def admin_required(fn):
    @wraps(fn)
    @auth_required
    def wrapper(*args, **kwargs):
        if int(g.current_user["is_admin"] or 0) != 1:
            return jsonify({"error": "Admin access required."}), 403
        return fn(*args, **kwargs)

    return wrapper


def upsert_profile(user_id, quiz_answers):
    db = get_db()
    db.execute(
        """
        INSERT INTO profiles (user_id, quiz_answers, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id)
        DO UPDATE SET quiz_answers = excluded.quiz_answers, updated_at = excluded.updated_at
        """,
        (user_id, json.dumps(quiz_answers), utc_now_iso()),
    )
    db.commit()


def get_profile(user_id):
    db = get_db()
    row = db.execute("SELECT quiz_answers, updated_at FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        return {"quiz_answers": {}, "updated_at": None}
    return {
        "quiz_answers": json.loads(row["quiz_answers"] or "{}"),
        "updated_at": row["updated_at"],
    }


def get_saved_variants(user_id):
    rows = get_db().execute(
        """
        SELECT variant_key, model, variant, year, price, fuel, seats, body_type, image_url, created_at
        FROM saved_variants
        WHERE user_id = ?
        ORDER BY created_at DESC
        """,
        (user_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def send_password_reset_email(to_email, token):
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    reset_link = f"{frontend_url}/reset-password?token={token}"

    smtp_host = os.getenv("SMTP_HOST")
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_from = os.getenv("SMTP_FROM", smtp_user or "noreply@mgnition.local")

    if not smtp_host or not smtp_user or not smtp_pass:
        return {"sent": False, "dev_token": token, "reset_link": reset_link}

    msg = MIMEText(
        f"Use this link to reset your MGNITION password:\n\n{reset_link}\n\nThis link expires in 30 minutes.",
        "plain",
    )
    msg["Subject"] = "MGNITION password reset"
    msg["From"] = smtp_from
    msg["To"] = to_email

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_from, [to_email], msg.as_string())

    return {"sent": True, "reset_link": reset_link}


def load_variant_catalog():
    if not VARIANT_DATA_PATH.exists():
        return []
    raw = json.loads(VARIANT_DATA_PATH.read_text())
    catalog = []
    for r in raw:
        if not r.get("Model"):
            continue
        price_val = safe_float(r.get("Price_THB"), 0)
        color_images = extract_color_images(r)
        default_color = clean_str(r.get("Default_Color")) or next(iter(color_images), "")
        default_image = color_images.get(default_color, "") if default_color else ""
        catalog.append(
            {
                "variant_key": variant_key(r),
                "model": clean_str(r.get("Model")),
                "variant": clean_str(r.get("Variant")),
                "year": clean_str(r.get("Year")),
                "price_thb": price_val,
                "starting_price": fmt_price(price_val),
                "fuel_type": clean_str(r.get("Fuel_Type")),
                "seats": int(safe_float(r.get("Seats"), 0) or 0),
                "body_type": clean_str(r.get("Body_Type")),
                "horsepower_hp": safe_float(r.get("Horsepower_hp"), 0),
                "torque_nm": safe_float(r.get("Torque_Nm"), 0),
                "cargo_liters": safe_float(r.get("Cargo_Liters"), 0),
                "length_mm": safe_float(r.get("Length_mm"), 0),
                "width_mm": safe_float(r.get("Width_mm"), 0),
                "height_mm": safe_float(r.get("Height_mm"), 0),
                "wheelbase_mm": safe_float(r.get("Wheelbase_mm"), 0),
                "range_km": safe_float(r.get("Range_km"), 0),
                "fuel_consumption_kml": safe_float(r.get("Fuel_Consumption_kmL"), 0),
                "image_url": default_image or clean_str(r.get("Image_URL")),
                "color_images": color_images,
                "default_color": default_color,
            }
        )
    return catalog


BASE_VARIANTS = load_variant_catalog()


def load_admin_variants():
    rows = get_db().execute(
        """
        SELECT id, model, variant, year, price_thb, fuel_type, seats, body_type,
               horsepower_hp, torque_nm, range_km, cargo_liters, image_url
        FROM admin_models
        WHERE active = 1
        """
    ).fetchall()
    variants = []
    for r in rows:
        variants.append(
            {
                "variant_key": f"ADMIN|{r['id']}",
                "model": clean_str(r["model"]),
                "variant": clean_str(r["variant"]),
                "year": clean_str(r["year"]),
                "price_thb": safe_float(r["price_thb"], 0),
                "starting_price": fmt_price(r["price_thb"]),
                "fuel_type": clean_str(r["fuel_type"]),
                "seats": int(safe_float(r["seats"], 0) or 0),
                "body_type": clean_str(r["body_type"]),
                "horsepower_hp": safe_float(r["horsepower_hp"], 0),
                "torque_nm": safe_float(r["torque_nm"], 0),
                "cargo_liters": safe_float(r["cargo_liters"], 0),
                "length_mm": 0,
                "width_mm": 0,
                "height_mm": 0,
                "wheelbase_mm": 0,
                "range_km": safe_float(r["range_km"], 0),
                "fuel_consumption_kml": 0,
                "image_url": clean_str(r["image_url"]),
            }
        )
    return variants


def get_all_variants():
    return BASE_VARIANTS + load_admin_variants()


def variant_lookup():
    return {v["variant_key"]: v for v in get_all_variants()}


def _as_list(v):
    if isinstance(v, list):
        return [clean_str(x) for x in v if clean_str(x)]
    if isinstance(v, str):
        return [x.strip() for x in v.split(",") if x.strip()]
    c = clean_str(v)
    return [c] if c else []


def _is_ev_preference(v):
    t = normalize_text(v)
    if not t:
        return 0
    if "ev" in t or "electric" in t:
        if "hev" in t or "hybrid" in t:
            return 0
        return 1
    return 0


def map_answers_to_cosine_input(answers):
    budget_choice = clean_str(answers.get("budget_choice")) or clean_str(answers.get("budget"))
    seat_choice = clean_str(answers.get("seat_choice")) or clean_str(answers.get("seats"))
    occupation = clean_str(answers.get("occupation")) or "Others"
    hobbies = _as_list(answers.get("hobbies"))
    usage_raw = answers.get("usage", [])
    usage = _as_list(usage_raw) if isinstance(usage_raw, str) else _as_list(usage_raw)
    daily_distance = clean_str(answers.get("daily_distance")) or clean_str(answers.get("distance")) or "Medium commute (30-80 km)"

    fuel_type_ev_raw = answers.get("fuel_type_EV")
    if fuel_type_ev_raw is None:
        fuel_type_ev = _is_ev_preference(answers.get("fuelType") or answers.get("fuel_type"))
    else:
        fuel_type_ev = int(safe_float(fuel_type_ev_raw, 0) or 0)

    out = {
        "budget_choice": budget_choice,
        "seat_choice": seat_choice,
        "fuel_type_EV": fuel_type_ev,
        "occupation": occupation,
        "hobbies": hobbies,
        "usage": usage,
        "daily_distance": daily_distance,
    }

    if answers.get("max_price_thb") is not None:
        out["max_price_thb"] = safe_float(answers.get("max_price_thb"), None)
    if answers.get("min_seats") is not None:
        out["min_seats"] = int(safe_float(answers.get("min_seats"), 0) or 0)
    if answers.get("max_seats") is not None:
        out["max_seats"] = int(safe_float(answers.get("max_seats"), 0) or 0)
    return out


COSINE_REASON_LABELS = {
    "price_weight": "Budget alignment",
    "hp_weight": "Power preference alignment",
    "seats_weight": "Seat capacity alignment",
    "range_weight": "Driving range alignment",
    "cargo_weight": "Cargo space alignment",
    "torque_weight": "Torque/acceleration alignment",
    "suv_pref": "SUV body type alignment",
    "sedan_pref": "Sedan/Hatchback body type alignment",
    "fuel_ev_weight": "EV fuel alignment",
    "fuel_hev_weight": "Hybrid fuel alignment",
    "fuel_ice_weight": "Petrol/Diesel fuel alignment",
    "efficiency_weight": "Efficiency alignment",
}


def build_cosine_explanation(car_row, user_profile, final_score, answers=None):
    contributions = []
    for key in COSINE_FEATURE_ORDER:
        u = safe_float(user_profile.get(key), 0)
        c = safe_float(car_row.get(key), 0)
        contributions.append((key, u * c))
    contributions.sort(key=lambda x: x[1], reverse=True)

    top = [(k, v) for k, v in contributions if v > 0][:3]
    factors = []
    for key, val in top:
        label = COSINE_REASON_LABELS.get(key, key)
        if key == "price_weight":
            detail = f"Price {fmt_price(car_row.get('price_thb'))} aligns with your budget preference."
        elif key == "seats_weight":
            detail = f"Seat capacity ({int(safe_float(car_row.get('seats'), 0) or 0)} seats) aligns with your need."
        elif key == "fuel_ev_weight":
            detail = f"Fuel type ({clean_str(car_row.get('fuel_type')) or 'N/A'}) aligns with EV preference."
        elif key == "range_weight":
            detail = f"Range ({int(safe_float(car_row.get('range_km'), 0) or 0)} km) aligns with your daily distance."
        elif key == "cargo_weight":
            detail = f"Cargo capacity ({int(safe_float(car_row.get('cargo_liters'), 0) or 0)} L) aligns with lifestyle needs."
        else:
            detail = f"{label} contributed strongly to the cosine similarity score."
        factors.append(
            {
                "key": key,
                "label": label,
                "points": round(float(val), 4),
                "detail": detail,
            }
        )

    top_reasons = build_template_reasons(answers or {}, car_row)
    if not top_reasons:
        top_reasons = ["Matched overall preferences from your quiz."]

    return {
        "top_reasons": top_reasons,
        "factors": factors,
        "rule_score": None,
        "ml_score": None,
        "final_score": round(float(final_score), 4),
    }


def rule_breakdown(variant, answers):
    points = {
        "fuel_fit": 0.0,
        "seat_fit": 0.0,
        "budget_fit": 0.0,
        "usage_fit": 0.0,
        "distance_fit": 0.0,
    }
    fuel = normalize_text(answers.get("fuelType"))
    seats = clean_str(answers.get("seats"))
    budget = normalize_text(answers.get("budget"))
    usage = normalize_text(answers.get("usage"))
    distance = normalize_text(answers.get("distance"))

    if fuel and fuel.split(" ")[0] in normalize_text(variant["fuel_type"]):
        points["fuel_fit"] = 4.0

    if seats:
        if "2" in seats and variant["seats"] == 2:
            points["seat_fit"] = 3.0
        if "3-5" in seats and 3 <= variant["seats"] <= 5:
            points["seat_fit"] = 3.0
        if "5+" in seats and variant["seats"] >= 5:
            points["seat_fit"] = 3.0

    p = variant["price_thb"]
    if "below 700" in budget and p <= 700000:
        points["budget_fit"] = 3.0
    elif "700,000" in budget and "999" in budget and 700000 <= p <= 999999:
        points["budget_fit"] = 3.0
    elif "1,000,000" in budget and 1000000 <= p <= 1299999:
        points["budget_fit"] = 3.0
    elif "1,300,000" in budget and p >= 1300000:
        points["budget_fit"] = 3.0

    if usage:
        if "city" in usage and variant["body_type"] in ("Hatchback", "Sedan", "SUV"):
            points["usage_fit"] += 1.0
        if "cargo" in usage and variant["cargo_liters"] >= 450:
            points["usage_fit"] += 1.0
        if "highway" in usage and (variant["range_km"] >= 420 or variant["horsepower_hp"] >= 170):
            points["usage_fit"] += 1.0
        if "eco" in usage and normalize_text(variant["fuel_type"]) in ("ev", "hybrid", "plug-in hybrid"):
            points["usage_fit"] += 1.0

    if distance:
        if "short" in distance and variant["range_km"] >= 250:
            points["distance_fit"] += 1.0
        if "medium" in distance and variant["range_km"] >= 350:
            points["distance_fit"] += 1.0
        if "long" in distance and variant["range_km"] >= 420:
            points["distance_fit"] += 1.0
        if "very long" in distance and variant["range_km"] >= 500:
            points["distance_fit"] += 1.0

    return points, sum(points.values())


def rule_score(variant, answers):
    _breakdown, total = rule_breakdown(variant, answers)
    return total


def build_template_reasons(answers, variant):
    reasons = []
    price = safe_float(variant.get("price_thb"), 0)
    fuel_type = normalize_text(variant.get("fuel_type"))
    seats = int(safe_float(variant.get("seats"), 0) or 0)

    budget_text = normalize_text(answers.get("budget_choice") or answers.get("budget"))
    max_price = answers.get("max_price_thb")
    if max_price is not None:
        max_price_val = safe_float(max_price, 0)
        if price and price <= max_price_val:
            reasons.append(f"Budget fit: {fmt_price(price)} is within your max price.")
    elif budget_text:
        if "below 700" in budget_text and price and price <= 700000:
            reasons.append(f"Budget fit: {fmt_price(price)} is within your range (below ฿700,000).")
        elif "700,000" in budget_text and "999" in budget_text and 700000 <= price <= 999999:
            reasons.append(f"Budget fit: {fmt_price(price)} matches your ฿700,000–฿999,999 range.")
        elif "1,000,000" in budget_text and 1000000 <= price <= 1299999:
            reasons.append(f"Budget fit: {fmt_price(price)} matches your ฿1,000,000–฿1,299,999 range.")
        elif "1,300,000" in budget_text and price >= 1300000:
            reasons.append(f"Budget fit: {fmt_price(price)} fits your premium budget range.")

    seat_choice = normalize_text(answers.get("seat_choice") or answers.get("seats"))
    if seat_choice:
        if "2" in seat_choice and "seat" in seat_choice and seats == 2:
            reasons.append(f"Seats: {seats} seats matches your preference.")
        elif "3-5" in seat_choice and 3 <= seats <= 5:
            reasons.append(f"Seats: {seats} seats matches your family use.")
        elif ("5+" in seat_choice or "5" in seat_choice) and seats >= 5:
            reasons.append(f"Seats: {seats} seats fits your group size.")

    fuel_pref = normalize_text(answers.get("fuelType") or answers.get("fuel_type") or answers.get("fuel"))
    if fuel_pref:
        fuel_match = fuel_pref.split(" ")[0] in fuel_type
        if fuel_pref.startswith("ev") and "ev" in fuel_type and "hybrid" not in fuel_type:
            fuel_match = True
        if fuel_pref.startswith("hybrid") and "hybrid" in fuel_type:
            fuel_match = True
        if fuel_match:
            label = clean_str(answers.get("fuelType") or answers.get("fuel_type") or answers.get("fuel"))
            reasons.append(f"Fuel: {label} aligns with your eco preference.")

    if len(reasons) < 3:
        distance = normalize_text(answers.get("daily_distance") or answers.get("distance"))
        range_km = int(safe_float(variant.get("range_km"), 0) or 0)
        if distance and range_km:
            reasons.append(f"Range: {range_km} km fits your daily distance.")

    if len(reasons) < 3:
        usage_val = answers.get("usage")
        if isinstance(usage_val, list):
            usage_val = " ".join([clean_str(x) for x in usage_val if clean_str(x)])
        usage = normalize_text(usage_val)
        cargo = int(safe_float(variant.get("cargo_liters"), 0) or 0)
        body = normalize_text(variant.get("body_type"))
        if "cargo" in usage and cargo >= 400:
            reasons.append(f"Cargo: {cargo} L supports your practical use.")
        elif "city" in usage and body:
            reasons.append(f"Body type: {variant.get('body_type')} suits city driving.")

    if not reasons:
        reasons.append("Matched overall preferences from your quiz.")

    return reasons[:3]


def explain_variant_reasons(variant, answers, breakdown, rule_total, ml_score, final_score):
    labels = {
        "fuel_fit": "Fuel type match",
        "seat_fit": "Seat capacity match",
        "budget_fit": "Budget range match",
        "usage_fit": "Driving usage match",
        "distance_fit": "Daily distance match",
    }
    details = {
        "fuel_fit": f"Your preferred fuel ({clean_str(answers.get('fuelType')) or 'N/A'}) aligns with {variant['fuel_type'] or 'this variant'}.",
        "seat_fit": f"Your seat need ({clean_str(answers.get('seats')) or 'N/A'}) aligns with {variant['seats']} seats.",
        "budget_fit": f"Price {fmt_price(variant['price_thb'])} fits your selected budget band.",
        "usage_fit": "Body type, cargo, and range align with your primary usage pattern.",
        "distance_fit": f"Range ({int(variant['range_km']) if variant['range_km'] else 0} km) fits your daily distance.",
    }

    ranked = sorted(breakdown.items(), key=lambda x: x[1], reverse=True)
    factors = []
    top_reasons = []
    for key, pts in ranked:
        if pts <= 0:
            continue
        item = {
            "key": key,
            "label": labels.get(key, key),
            "points": round(float(pts), 2),
            "detail": details.get(key, ""),
        }
        factors.append(item)
        top_reasons.append(f"{item['label']}: {item['detail']}")

    template_reasons = build_template_reasons(answers, variant)
    if template_reasons:
        top_reasons = template_reasons
    elif not top_reasons:
        top_reasons.append("No strong quiz match found, ranked by closest overall fit.")

    return {
        "top_reasons": top_reasons[:3],
        "factors": factors,
        "rule_score": round(float(rule_total), 2),
        "ml_score": round(float(ml_score), 4) if ml_score is not None else None,
        "final_score": round(float(final_score), 4),
    }


def featurize(variant, answers, base_rule):
    budget = normalize_text(answers.get("budget"))
    budget_target = 0
    if "below 700" in budget:
        budget_target = 700000
    elif "700,000" in budget and "999" in budget:
        budget_target = 850000
    elif "1,000,000" in budget:
        budget_target = 1150000
    elif "1,300,000" in budget:
        budget_target = 1500000

    seats_pref = clean_str(answers.get("seats"))
    seats_pref_num = 0
    if "2" in seats_pref:
        seats_pref_num = 2
    elif "3-5" in seats_pref:
        seats_pref_num = 5
    elif "5+" in seats_pref:
        seats_pref_num = 7

    return {
        "rule_score": base_rule,
        "price_thb": variant["price_thb"],
        "horsepower_hp": variant["horsepower_hp"],
        "torque_nm": variant["torque_nm"],
        "range_km": variant["range_km"],
        "cargo_liters": variant["cargo_liters"],
        "seats_num": variant["seats"],
        "budget_target": budget_target,
        "price_budget_gap": abs(variant["price_thb"] - budget_target) if budget_target else 0,
        "seat_gap": abs(variant["seats"] - seats_pref_num) if seats_pref_num else 0,
        "fuel_type": normalize_text(variant["fuel_type"]),
        "body_type": normalize_text(variant["body_type"]),
        "answer_fuel": normalize_text(answers.get("fuelType")),
        "answer_usage": normalize_text(answers.get("usage")),
        "answer_distance": normalize_text(answers.get("distance")),
        "answer_style": normalize_text(answers.get("style")),
        "answer_occupation": normalize_text(answers.get("occupation")),
    }


def load_model_artifact():
    if not SKLEARN_AVAILABLE or not MODEL_PATH.exists():
        return None
    try:
        return joblib.load(MODEL_PATH)
    except Exception:
        return None


MODEL_ARTIFACT = load_model_artifact()


def train_from_feedback(min_samples=25):
    global MODEL_ARTIFACT

    if not SKLEARN_AVAILABLE:
        return {"trained": False, "reason": "scikit-learn not installed"}

    db = create_db_connection()
    rec_rows = db.execute(
        """
        SELECT user_id, variant_key, answers_json, rule_score, served_at
        FROM recommendation_impressions
        WHERE user_id IS NOT NULL
        """
    ).fetchall()
    car_rows = db.execute(
        """
        SELECT user_id, variant_key, answers_json, served_at
        FROM car_impressions
        WHERE user_id IS NOT NULL
        """
    ).fetchall()

    if len(rec_rows) + len(car_rows) < min_samples:
        db.close()
        return {
            "trained": False,
            "reason": f"need at least {min_samples} samples",
            "samples": len(rec_rows) + len(car_rows),
        }

    feedback_rows = db.execute(
        """
        SELECT user_id, variant_key, event_type, created_at
        FROM user_feedback
        WHERE event_type IN ('save', 'booking')
        """
    ).fetchall()

    feedback_map = {}
    for f in feedback_rows:
        key = (f["user_id"], f["variant_key"])
        bucket = feedback_map.setdefault(key, {"save": [], "booking": []})
        ts = parse_iso(f["created_at"])
        if ts and f["event_type"] in bucket:
            bucket[f["event_type"]].append(ts)

    rows = []
    for r in rec_rows:
        rows.append(
            {
                "user_id": r["user_id"],
                "variant_key": r["variant_key"],
                "answers_json": r["answers_json"],
                "rule_score": r["rule_score"] or 0,
                "served_at": r["served_at"],
            }
        )
    for r in car_rows:
        rows.append(
            {
                "user_id": r["user_id"],
                "variant_key": r["variant_key"],
                "answers_json": r["answers_json"],
                "rule_score": 0,
                "served_at": r["served_at"],
            }
        )

    variants = {v["variant_key"]: v for v in BASE_VARIANTS}
    admin = db.execute(
        "SELECT id, model, variant, year, price_thb, fuel_type, seats, body_type, horsepower_hp, torque_nm, range_km, cargo_liters, image_url FROM admin_models"
    ).fetchall()
    for a in admin:
        variants[f"ADMIN|{a['id']}"] = {
            "variant_key": f"ADMIN|{a['id']}",
            "model": clean_str(a["model"]),
            "variant": clean_str(a["variant"]),
            "year": clean_str(a["year"]),
            "price_thb": safe_float(a["price_thb"], 0),
            "fuel_type": clean_str(a["fuel_type"]),
            "seats": int(safe_float(a["seats"], 0) or 0),
            "body_type": clean_str(a["body_type"]),
            "horsepower_hp": safe_float(a["horsepower_hp"], 0),
            "torque_nm": safe_float(a["torque_nm"], 0),
            "range_km": safe_float(a["range_km"], 0),
            "cargo_liters": safe_float(a["cargo_liters"], 0),
        }

    xs = []
    ys = []
    ws = []
    for r in rows:
        v = variants.get(r["variant_key"])
        if not v:
            continue
        answers = json.loads(r["answers_json"] or "{}")
        xs.append(featurize(v, answers, r["rule_score"] or 0))
        served = parse_iso(r["served_at"])
        fb = feedback_map.get((r["user_id"], r["variant_key"]), {"save": [], "booking": []})
        has_save = any(ts and served and ts >= served for ts in fb.get("save", []))
        has_booking = any(ts and served and ts >= served for ts in fb.get("booking", []))
        label = 1 if (has_save or has_booking) else 0
        ys.append(label)
        ws.append(2.6 if has_booking else (1.4 if has_save else 1.0))

    if len(xs) < min_samples or len(set(ys)) < 2:
        db.close()
        return {"trained": False, "reason": "insufficient labeled diversity", "samples": len(xs)}

    vec = DictVectorizer(sparse=True)
    X = vec.fit_transform(xs)
    clf = SGDClassifier(loss="log_loss", max_iter=3000, random_state=42)
    clf.fit(X, ys, sample_weight=ws)

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    artifact = {
        "vectorizer": vec,
        "model": clf,
        "trained_at": utc_now_iso(),
        "samples": len(ys),
        "positives": int(sum(ys)),
    }
    joblib.dump(artifact, MODEL_PATH)
    MODEL_ARTIFACT = artifact
    db.close()

    return {"trained": True, "samples": len(ys), "positives": int(sum(ys)), "trained_at": artifact["trained_at"]}


def recommend_variants(answers, top_k=6):
    artifact = MODEL_ARTIFACT
    variants = get_all_variants()
    ranked = []

    for v in variants:
        breakdown, base_rule = rule_breakdown(v, answers)
        base_norm = min(base_rule / 12.0, 1.0)
        ml_score = None
        final = base_norm

        if artifact:
            feat = featurize(v, answers, base_rule)
            X = artifact["vectorizer"].transform([feat])
            ml_score = float(artifact["model"].predict_proba(X)[0][1])
            final = 0.7 * ml_score + 0.3 * base_norm

        explanation = explain_variant_reasons(v, answers, breakdown, base_rule, ml_score, final)
        ranked.append(
            {
                **v,
                "rule_score": round(base_rule, 4),
                "rule_breakdown": {k: round(float(val), 2) for k, val in breakdown.items()},
                "ml_score": ml_score,
                "score": round(final, 6),
                "explanation": explanation,
            }
        )

    ranked.sort(key=lambda x: x["score"], reverse=True)
    return ranked[:top_k]


def log_impressions(user_id, answers, recommended):
    db = get_db()
    now = utc_now_iso()
    for i, r in enumerate(recommended, start=1):
        db.execute(
            """
            INSERT INTO recommendation_impressions
            (user_id, variant_key, served_at, rank_pos, rule_score, ml_score, final_score, answers_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, r["variant_key"], now, i, r["rule_score"], r["ml_score"], r["score"], json.dumps(answers)),
        )
    db.commit()


def log_car_impressions(user_id, answers, variant_keys, source=None):
    db = get_db()
    now = utc_now_iso()
    cleaned = [clean_str(k) for k in (variant_keys or []) if clean_str(k)]
    if not cleaned:
        return 0
    payload = json.dumps(answers or {})
    src = clean_str(source) or None
    for key in cleaned:
        db.execute(
            """
            INSERT INTO car_impressions (user_id, variant_key, served_at, source, answers_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, key, now, src, payload),
        )
    db.commit()
    return len(cleaned)


def insert_feedback(user_id, variant_key, event_type, payload=None):
    db = get_db()
    db.execute(
        "INSERT INTO user_feedback (user_id, variant_key, event_type, created_at, payload_json) VALUES (?, ?, ?, ?, ?)",
        (user_id, variant_key, event_type, utc_now_iso(), json.dumps(payload or {})),
    )
    db.commit()


def user_payload(user_row):
    return {
        "id": user_row["id"],
        "full_name": user_row["full_name"],
        "email": user_row["email"],
        "phone": user_row["phone"],
        "created_at": user_row["created_at"],
        "is_admin": int(user_row["is_admin"] or 0) == 1,
    }


@app.get("/")
def root():
    return jsonify(
        {
            "message": "MGNITION API running",
            "endpoints": [
                "/auth/signup",
                "/auth/login",
                "/auth/password-reset/request",
                "/auth/password-reset/confirm",
                "/me",
                "/profile",
                "/saved-models",
                "/bookings",
                "/feedback/click",
                "/recommend",
                "/public/promotions",
                "/public/admin-models",
                "/admin/analytics",
                "/admin/bookings",
                "/admin/promotions",
                "/admin/models",
                "/ml/status",
                "/ml/retrain",
            ],
        }
    )


@app.get("/health")
def health():
    return jsonify({"status": "ok", "variants": len(get_all_variants())})


@app.post("/auth/signup")
def signup():
    payload = request.get_json(silent=True) or {}
    full_name = clean_str(payload.get("full_name"))
    email = clean_str(payload.get("email")).lower()
    password = payload.get("password") or ""
    confirm_password = payload.get("confirm_password") or ""
    phone = clean_str(payload.get("phone"))

    if not full_name or not email or not password:
        return jsonify({"error": "Full name, email, and password are required."}), 400
    if "@" not in email:
        return jsonify({"error": "Please provide a valid email address."}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters."}), 400
    if password != confirm_password:
        return jsonify({"error": "Passwords do not match."}), 400

    db = get_db()
    if db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
        return jsonify({"error": "Email already registered."}), 409

    is_admin = 1 if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0 else 0
    db.execute(
        "INSERT INTO users (full_name, email, password_hash, phone, created_at, is_admin) VALUES (?, ?, ?, ?, ?, ?)",
        (full_name, email, generate_password_hash(password), phone, utc_now_iso(), is_admin),
    )
    db.commit()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    token = secrets.token_urlsafe(32)
    db.execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)", (token, user["id"], utc_now_iso()))
    db.commit()
    upsert_profile(user["id"], {})

    return jsonify({"token": token, "user": user_payload(user), "message": "Account created successfully."}), 201


@app.post("/auth/login")
def login():
    payload = request.get_json(silent=True) or {}
    email = clean_str(payload.get("email")).lower()
    password = payload.get("password") or ""

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid email or password."}), 401

    token = secrets.token_urlsafe(32)
    db.execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)", (token, user["id"], utc_now_iso()))
    db.commit()

    return jsonify(
        {
            "token": token,
            "user": user_payload(user),
            "profile": get_profile(user["id"]),
            "saved_models": get_saved_variants(user["id"]),
        }
    )


@app.post("/auth/logout")
@auth_required
def logout():
    db = get_db()
    db.execute("DELETE FROM sessions WHERE token = ?", (g.current_token,))
    db.commit()
    return jsonify({"message": "Logged out."})


@app.post("/auth/password-reset/request")
def password_reset_request():
    payload = request.get_json(silent=True) or {}
    email = clean_str(payload.get("email")).lower()
    if not email:
        return jsonify({"error": "Email is required."}), 400

    db = get_db()
    user = db.execute("SELECT id, email FROM users WHERE email = ?", (email,)).fetchone()
    if not user:
        return jsonify({"message": "If that email exists, a reset link has been sent."})

    token = secrets.token_urlsafe(32)
    expires = (utc_now() + timedelta(minutes=30)).isoformat(timespec="seconds") + "Z"
    db.execute(
        "INSERT INTO password_reset_tokens (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (token, user["id"], expires, utc_now_iso()),
    )
    db.commit()

    delivery = send_password_reset_email(user["email"], token)
    response = {"message": "If that email exists, a reset link has been sent."}
    if delivery.get("dev_token"):
        response["dev_token"] = delivery["dev_token"]
        response["dev_reset_link"] = delivery["reset_link"]
    return jsonify(response)


@app.post("/auth/password-reset/confirm")
def password_reset_confirm():
    payload = request.get_json(silent=True) or {}
    token = clean_str(payload.get("token"))
    new_password = payload.get("new_password") or ""
    confirm_password = payload.get("confirm_password") or ""

    if not token or not new_password:
        return jsonify({"error": "Token and new password are required."}), 400
    if len(new_password) < 8:
        return jsonify({"error": "Password must be at least 8 characters."}), 400
    if new_password != confirm_password:
        return jsonify({"error": "Passwords do not match."}), 400

    db = get_db()
    row = db.execute(
        "SELECT token, user_id, expires_at, used_at FROM password_reset_tokens WHERE token = ?",
        (token,),
    ).fetchone()
    if not row:
        return jsonify({"error": "Invalid or expired token."}), 400
    if row["used_at"]:
        return jsonify({"error": "Token already used."}), 400

    exp = parse_iso(row["expires_at"])
    if not exp or utc_now() > exp:
        return jsonify({"error": "Token expired."}), 400

    db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (generate_password_hash(new_password), row["user_id"]))
    db.execute("UPDATE password_reset_tokens SET used_at = ? WHERE token = ?", (utc_now_iso(), token))
    db.commit()
    return jsonify({"message": "Password updated successfully."})


@app.get("/me")
@auth_required
def me():
    return jsonify(
        {
            "user": user_payload(g.current_user),
            "profile": get_profile(g.current_user["id"]),
            "saved_models": get_saved_variants(g.current_user["id"]),
        }
    )


@app.put("/profile")
@auth_required
def update_profile():
    payload = request.get_json(silent=True) or {}
    quiz_answers = payload.get("quiz_answers")
    if not isinstance(quiz_answers, dict):
        return jsonify({"error": "quiz_answers must be an object."}), 400
    upsert_profile(g.current_user["id"], quiz_answers)
    return jsonify({"message": "Profile updated.", "profile": get_profile(g.current_user["id"])})


@app.get("/saved-models")
@auth_required
def list_saved_models():
    return jsonify({"saved_models": get_saved_variants(g.current_user["id"])})


@app.post("/saved-models")
@auth_required
def save_model():
    payload = request.get_json(silent=True) or {}
    model = clean_str(payload.get("model"))
    variant = clean_str(payload.get("variant"))
    year = clean_str(payload.get("year"))
    vk = clean_str(payload.get("variant_key")) or variant_key_from_values(model, variant, year)

    if not model:
        return jsonify({"error": "model is required."}), 400

    db = get_db()
    db.execute(
        """
        INSERT INTO saved_variants
        (user_id, variant_key, model, variant, year, price, fuel, seats, body_type, image_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, variant_key)
        DO UPDATE SET
          price = excluded.price,
          fuel = excluded.fuel,
          seats = excluded.seats,
          body_type = excluded.body_type,
          image_url = excluded.image_url,
          created_at = excluded.created_at
        """,
        (
            g.current_user["id"],
            vk,
            model,
            variant,
            year,
            clean_str(payload.get("price")),
            clean_str(payload.get("fuel")),
            clean_str(payload.get("seats")),
            clean_str(payload.get("bodyType") or payload.get("body_type")),
            clean_str(payload.get("imagePageUrl") or payload.get("image_url")),
            utc_now_iso(),
        ),
    )
    db.commit()

    insert_feedback(g.current_user["id"], vk, "save", {"model": model, "variant": variant})
    train_from_feedback(min_samples=25)

    return jsonify({"message": "Saved model updated.", "saved_models": get_saved_variants(g.current_user["id"])})


@app.delete("/saved-models/<path:variant_key_value>")
@auth_required
def remove_saved(variant_key_value):
    db = get_db()
    db.execute("DELETE FROM saved_variants WHERE user_id = ? AND variant_key = ?", (g.current_user["id"], variant_key_value))
    db.commit()
    return jsonify({"message": "Saved model removed.", "saved_models": get_saved_variants(g.current_user["id"])})


@app.post("/feedback/click")
@auth_required
def feedback_click():
    payload = request.get_json(silent=True) or {}
    vk = clean_str(payload.get("variant_key"))
    model = clean_str(payload.get("model"))
    if not vk:
        vk = variant_key_from_values(model, payload.get("variant"), payload.get("year"))
    if not vk:
        return jsonify({"error": "variant_key or model is required."}), 400
    insert_feedback(g.current_user["id"], vk, "click", payload)
    return jsonify({"message": "Click feedback logged."})


@app.post("/impressions")
def capture_impressions():
    payload = request.get_json(silent=True) or {}
    variant_keys = payload.get("variant_keys") or payload.get("variant_key") or []
    if isinstance(variant_keys, str):
        variant_keys = [variant_keys]
    if not isinstance(variant_keys, list):
        return jsonify({"error": "variant_keys must be a list"}), 400

    source = payload.get("source")
    answers = payload.get("answers") if isinstance(payload.get("answers"), dict) else None

    token = get_token_from_header()
    user = get_user_by_token(token) if token else None
    user_id = user["id"] if user else None
    if answers is None and user_id:
        answers = get_profile(user_id).get("quiz_answers") or {}

    logged = log_car_impressions(user_id, answers or {}, variant_keys, source=source)
    return jsonify({"message": "Impressions logged.", "logged": logged})


@app.post("/bookings")
@auth_required
def create_booking():
    payload = request.get_json(silent=True) or {}
    showroom_name = clean_str(payload.get("showroom_name"))
    model = clean_str(payload.get("model"))
    if not showroom_name or not model:
        return jsonify({"error": "showroom_name and model are required."}), 400

    db = get_db()
    db.execute(
        """
        INSERT INTO bookings
        (user_id, user_name, user_email, user_phone, showroom_id, showroom_name, showroom_address, province, model, variant, variant_key, notes, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        """,
        (
            g.current_user["id"],
            clean_str(payload.get("user_name")) or clean_str(g.current_user.get("full_name")),
            clean_str(payload.get("user_email")) or clean_str(g.current_user.get("email")),
            clean_str(payload.get("user_phone")) or clean_str(g.current_user.get("phone")),
            clean_str(payload.get("showroom_id")),
            showroom_name,
            clean_str(payload.get("showroom_address")),
            clean_str(payload.get("province")),
            model,
            clean_str(payload.get("variant")),
            clean_str(payload.get("variant_key")),
            clean_str(payload.get("notes")),
            utc_now_iso(),
        ),
    )
    db.commit()

    variant_key_value = clean_str(payload.get("variant_key"))
    if not variant_key_value:
        variant_key_value = variant_key_from_values(model, payload.get("variant"), payload.get("year"))
    if variant_key_value:
        insert_feedback(
            g.current_user["id"],
            variant_key_value,
            "booking",
            {
                "model": model,
                "variant": clean_str(payload.get("variant")),
                "showroom_id": clean_str(payload.get("showroom_id")),
                "showroom_name": showroom_name,
            },
        )
        train_from_feedback(min_samples=20)

    return jsonify({"message": "Booking created successfully."}), 201


@app.post("/recommend")
def recommend():
    answers = request.get_json(silent=True) or {}
    if not isinstance(answers, dict):
        answers = {}

    token = get_token_from_header()
    user = get_user_by_token(token)
    user_id = user["id"] if user else None
    if user_id and isinstance(answers, dict):
        upsert_profile(user_id, answers)

    top = []
    if COSINE_AVAILABLE:
        car_df = pd.DataFrame(get_all_variants())
        cosine_input = map_answers_to_cosine_input(answers)
        ranked_df, user_profile, _feature_cols, msg = score_cars_with_cosine(car_df, cosine_input, debug=False)

        if msg:
            return jsonify({"recommendations": [], "message": msg, "engine": "cosine_similarity"})

        ranked_df = ranked_df.sort_values("similarity_score", ascending=False).head(6)

        def _safe_text(v):
            if v is None:
                return ""
            if isinstance(v, float) and v != v:
                return ""
            s = str(v).strip()
            return "" if s.lower() == "nan" else s

        for _, row in ranked_df.iterrows():
            r = row.to_dict()
            score = round(float(safe_float(r.get("similarity_score"), 0)), 6)
            explanation = build_cosine_explanation(r, user_profile, score, answers)
            top.append(
                {
                    "variant_key": clean_str(r.get("variant_key")),
                    "model": clean_str(r.get("model")),
                    "variant": clean_str(r.get("variant")),
                    "year": clean_str(r.get("year")),
                    "starting_price": _safe_text(r.get("starting_price")) or fmt_price(r.get("price_thb")),
                    "price_thb": safe_float(r.get("price_thb"), 0),
                    "fuel_type": clean_str(r.get("fuel_type")),
                    "seats": int(safe_float(r.get("seats"), 0) or 0),
                    "body_type": clean_str(r.get("body_type")),
                    "range_km": safe_float(r.get("range_km"), 0),
                    "horsepower_hp": safe_float(r.get("horsepower_hp"), 0),
                    "torque_nm": safe_float(r.get("torque_nm"), 0),
                    "image_url": _safe_text(r.get("image_url")),
                    "color_images": r.get("color_images") if isinstance(r.get("color_images"), dict) else {},
                    "default_color": _safe_text(r.get("default_color")),
                    "rule_score": None,
                    "ml_score": None,
                    "score": score,
                    "reason": "Cosine similarity from quiz profile + hard constraints",
                    "explanation": explanation,
                    "rule_breakdown": {f["key"]: f["points"] for f in explanation.get("factors", [])},
                }
            )
    else:
        top = recommend_variants(answers, top_k=6)

    log_impressions(user_id, answers, top)

    out = []
    for r in top:
        out.append(
            {
                "variant_key": r["variant_key"],
                "model": r["model"],
                "variant": r["variant"],
                "year": r["year"],
                "starting_price": r["starting_price"],
                "price": r["starting_price"],
                "fuel": r["fuel_type"],
                "seats": str(r["seats"]),
                "bodyType": r["body_type"],
                "range_km": r["range_km"],
                "horsepower_hp": r["horsepower_hp"],
                "torque_nm": r["torque_nm"],
                "imagePageUrl": r["image_url"],
                "color_images": r.get("color_images", {}),
                "default_color": r.get("default_color", ""),
                "score": r["score"],
                "reason": r.get("reason") or "Hybrid ranking from quiz + behavior learning",
                "explanation": r.get("explanation", {}),
                "rule_breakdown": r.get("rule_breakdown", {}),
            }
        )

    payload = {"recommendations": out}
    if COSINE_AVAILABLE:
        payload["engine"] = "cosine_similarity"
    else:
        payload["engine"] = "hybrid_rule_ml_fallback"
        if COSINE_IMPORT_ERROR:
            payload["cosine_error"] = COSINE_IMPORT_ERROR
    return jsonify(payload)


@app.get("/public/promotions")
def public_promotions():
    rows = get_db().execute(
        """
        SELECT id, title, description, price_text, badge_text, image_url, model_name, variant_name, variant_key, start_date, end_date
        FROM promotions
        WHERE active = 1
        ORDER BY id DESC
        """
    ).fetchall()
    return jsonify({"promotions": [dict(r) for r in rows]})


@app.get("/public/admin-models")
def public_admin_models():
    rows = get_db().execute(
        """
        SELECT id, model, variant, year, price_thb, fuel_type, seats, body_type,
               horsepower_hp, torque_nm, range_km, cargo_liters, image_url
        FROM admin_models
        WHERE active = 1
        ORDER BY id DESC
        """
    ).fetchall()
    models = []
    for r in rows:
        models.append(
            {
                "variant_key": f"ADMIN|{r['id']}",
                "model": r["model"],
                "variant": r["variant"],
                "year": r["year"],
                "price": fmt_price(r["price_thb"]),
                "starting_price": fmt_price(r["price_thb"]),
                "fuel": r["fuel_type"],
                "seats": str(r["seats"] or ""),
                "bodyType": r["body_type"],
                "horsepower_hp": r["horsepower_hp"],
                "torque_nm": r["torque_nm"],
                "range_km": r["range_km"],
                "cargo_liters": r["cargo_liters"],
                "imagePageUrl": r["image_url"],
            }
        )
    return jsonify({"models": models})


@app.get("/public/best-sellers")
def public_best_sellers():
    rows = get_db().execute(
        """
        SELECT id, model_name, variant_name, variant_key, rank
        FROM best_sellers
        WHERE active = 1
        ORDER BY rank ASC, id ASC
        """
    ).fetchall()
    return jsonify({"best_sellers": [dict(r) for r in rows]})


@app.get("/admin/analytics")
@admin_required
def admin_analytics():
    db = get_db()

    top_clicks = db.execute(
        """
        SELECT variant_key, COUNT(*) AS cnt
        FROM user_feedback
        WHERE event_type = 'click'
        GROUP BY variant_key
        ORDER BY cnt DESC
        LIMIT 10
        """
    ).fetchall()

    top_saves = db.execute(
        """
        SELECT variant_key, COUNT(*) AS cnt
        FROM user_feedback
        WHERE event_type = 'save'
        GROUP BY variant_key
        ORDER BY cnt DESC
        LIMIT 10
        """
    ).fetchall()

    top_bookings = db.execute(
        """
        SELECT
            CASE
              WHEN COALESCE(variant_key, '') = '' THEN COALESCE(model, 'Unknown')
              ELSE variant_key
            END AS variant_key,
            COUNT(*) AS cnt
        FROM bookings
        GROUP BY
            CASE
              WHEN COALESCE(variant_key, '') = '' THEN COALESCE(model, 'Unknown')
              ELSE variant_key
            END
        ORDER BY cnt DESC
        LIMIT 10
        """
    ).fetchall()

    rows = db.execute("SELECT user_id, variant_key, answers_json, served_at FROM recommendation_impressions").fetchall()

    seg = {}
    for r in rows:
        answers = json.loads(r["answers_json"] or "{}")
        fuel_seg = clean_str(answers.get("fuelType")) or "Unknown"
        budget_seg = clean_str(answers.get("budget")) or "Unknown"
        k = f"{fuel_seg} | {budget_seg}"
        if k not in seg:
            seg[k] = {"segment": k, "impressions": 0, "saves": 0}
        seg[k]["impressions"] += 1

    saves = db.execute("SELECT user_id, variant_key, created_at FROM user_feedback WHERE event_type = 'save'").fetchall()
    for s in saves:
        created = parse_iso(s["created_at"])
        if not created:
            continue
        for r in rows:
            if r["user_id"] == s["user_id"] and r["variant_key"] == s["variant_key"]:
                served = parse_iso(r["served_at"])
                if served and created >= served:
                    answers = json.loads(r["answers_json"] or "{}")
                    fuel_seg = clean_str(answers.get("fuelType")) or "Unknown"
                    budget_seg = clean_str(answers.get("budget")) or "Unknown"
                    k = f"{fuel_seg} | {budget_seg}"
                    if k in seg:
                        seg[k]["saves"] += 1
                    break

    conv = []
    for item in seg.values():
        imp = item["impressions"]
        sv = item["saves"]
        item["conversion_rate"] = round((sv / imp) * 100, 2) if imp else 0.0
        conv.append(item)

    conv.sort(key=lambda x: x["conversion_rate"], reverse=True)

    return jsonify(
        {
            "top_clicked_variants": [dict(r) for r in top_clicks],
            "top_saved_variants": [dict(r) for r in top_saves],
            "top_booked_variants": [dict(r) for r in top_bookings],
            "conversion_by_quiz_segment": conv[:20],
        }
    )


@app.get("/admin/bookings")
@admin_required
def admin_bookings():
    rows = get_db().execute(
        """
        SELECT id, user_id, user_name, user_email, user_phone, showroom_id, showroom_name, showroom_address,
               province, model, variant, variant_key, notes, status, created_at
        FROM bookings
        ORDER BY created_at DESC
        LIMIT 300
        """
    ).fetchall()
    return jsonify({"bookings": [dict(r) for r in rows]})


@app.get("/admin/users")
@admin_required
def admin_users():
    rows = get_db().execute(
        """
        SELECT id, full_name, email, phone, created_at, is_admin
        FROM users
        ORDER BY created_at DESC
        LIMIT 500
        """
    ).fetchall()
    return jsonify({"users": [dict(r) for r in rows]})


@app.get("/admin/promotions")
@admin_required
def admin_promotions():
    rows = get_db().execute(
        """
        SELECT id, title, description, price_text, badge_text, image_url, model_name, variant_name, variant_key,
               start_date, end_date, active, created_by, created_at
        FROM promotions
        ORDER BY id DESC
        """
    ).fetchall()
    return jsonify({"promotions": [dict(r) for r in rows]})


@app.get("/admin/best-sellers")
@admin_required
def admin_best_sellers():
    rows = get_db().execute(
        """
        SELECT id, model_name, variant_name, variant_key, rank, active, created_at
        FROM best_sellers
        ORDER BY rank ASC, id ASC
        """
    ).fetchall()
    return jsonify({"best_sellers": [dict(r) for r in rows]})


@app.post("/admin/best-sellers")
@admin_required
def add_best_seller():
    payload = request.get_json(silent=True) or {}
    model_name = clean_str(payload.get("model_name"))
    if not model_name:
        return jsonify({"error": "model_name is required."}), 400

    variant_key = clean_str(payload.get("variant_key"))
    variant_name = clean_str(payload.get("variant_name"))
    rank = int(safe_float(payload.get("rank"), 1) or 1)

    db = get_db()
    db.execute(
        """
        INSERT INTO best_sellers (model_name, variant_name, variant_key, rank, active, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (model_name, variant_name, variant_key, rank, 1, g.current_user["id"], utc_now_iso()),
    )
    db.commit()
    return admin_best_sellers()


@app.patch("/admin/best-sellers/<int:best_id>")
@admin_required
def update_best_seller(best_id):
    payload = request.get_json(silent=True) or {}
    active = payload.get("active")
    rank = payload.get("rank")
    updates = []
    params = []
    if active is not None:
        updates.append("active = ?")
        params.append(1 if bool(active) else 0)
    if rank is not None:
        updates.append("rank = ?")
        params.append(int(safe_float(rank, 1) or 1))
    if not updates:
        return jsonify({"error": "No valid fields to update."}), 400
    params.append(best_id)
    get_db().execute(f"UPDATE best_sellers SET {', '.join(updates)} WHERE id = ?", params)
    get_db().commit()
    return admin_best_sellers()


@app.delete("/admin/best-sellers/<int:best_id>")
@admin_required
def delete_best_seller(best_id):
    db = get_db()
    db.execute("DELETE FROM best_sellers WHERE id = ?", (best_id,))
    db.commit()
    return admin_best_sellers()


@app.post("/admin/promotions")
@admin_required
def admin_add_promotion():
    payload = request.get_json(silent=True) or {}
    title = clean_str(payload.get("title"))
    if not title:
        return jsonify({"error": "title is required."}), 400

    model_name = clean_str(payload.get("model_name"))
    bound_variant_key = clean_str(payload.get("variant_key"))
    bound_variant_name = clean_str(payload.get("variant_name"))

    selected_variant = None
    if bound_variant_key:
        selected_variant = next((v for v in get_all_variants() if clean_str(v.get("variant_key")) == bound_variant_key), None)
        if selected_variant:
            model_name = model_name or clean_str(selected_variant.get("model"))
            bound_variant_name = bound_variant_name or clean_str(selected_variant.get("variant"))

    image_url = clean_str(payload.get("image_url"))
    if not image_url and selected_variant:
        image_url = clean_str(selected_variant.get("image_url"))

    db = get_db()
    db.execute(
        """
        INSERT INTO promotions (title, description, price_text, badge_text, image_url, model_name, variant_name, variant_key, start_date, end_date, active, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        """,
        (
            title,
            clean_str(payload.get("description")),
            clean_str(payload.get("price_text")),
            clean_str(payload.get("badge_text")),
            image_url,
            model_name,
            bound_variant_name,
            bound_variant_key,
            clean_str(payload.get("start_date")),
            clean_str(payload.get("end_date")),
            g.current_user["id"],
            utc_now_iso(),
        ),
    )
    db.commit()
    return jsonify({"message": "Promotion added."}), 201


@app.delete("/admin/promotions/<int:promo_id>")
@admin_required
def admin_delete_promotion(promo_id):
    db = get_db()
    db.execute("UPDATE promotions SET active = 0 WHERE id = ?", (promo_id,))
    db.commit()
    return jsonify({"message": "Promotion deleted."})


@app.patch("/admin/promotions/<int:promo_id>")
@admin_required
def admin_update_promotion(promo_id):
    payload = request.get_json(silent=True) or {}
    if "active" not in payload:
        return jsonify({"error": "active is required."}), 400
    active = 1 if bool(payload.get("active")) else 0
    db = get_db()
    db.execute("UPDATE promotions SET active = ? WHERE id = ?", (active, promo_id))
    db.commit()
    return jsonify({"message": "Promotion updated.", "active": active})


@app.post("/admin/models")
@admin_required
def admin_add_model():
    payload = request.get_json(silent=True) or {}
    model = clean_str(payload.get("model"))
    if not model:
        return jsonify({"error": "model is required."}), 400

    db = get_db()
    db.execute(
        """
        INSERT INTO admin_models
        (model, variant, year, price_thb, fuel_type, seats, body_type, horsepower_hp, torque_nm, range_km, cargo_liters, image_url, active, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        """,
        (
            model,
            clean_str(payload.get("variant")),
            clean_str(payload.get("year")),
            safe_float(payload.get("price_thb"), 0),
            clean_str(payload.get("fuel_type")),
            int(safe_float(payload.get("seats"), 0) or 0),
            clean_str(payload.get("body_type")),
            safe_float(payload.get("horsepower_hp"), 0),
            safe_float(payload.get("torque_nm"), 0),
            safe_float(payload.get("range_km"), 0),
            safe_float(payload.get("cargo_liters"), 0),
            clean_str(payload.get("image_url")),
            g.current_user["id"],
            utc_now_iso(),
            utc_now_iso(),
        ),
    )
    db.commit()
    return jsonify({"message": "Model added."}), 201


@app.get("/ml/status")
def ml_status():
    artifact = MODEL_ARTIFACT
    return jsonify(
        {
            "sklearn_available": SKLEARN_AVAILABLE,
            "model_loaded": artifact is not None,
            "trained_at": artifact.get("trained_at") if artifact else None,
            "samples": artifact.get("samples") if artifact else 0,
            "positives": artifact.get("positives") if artifact else 0,
            "variants": len(get_all_variants()),
        }
    )


@app.post("/ml/retrain")
@admin_required
def ml_retrain():
    return jsonify(train_from_feedback(min_samples=10))


init_db()


if __name__ == "__main__":
    debug = os.getenv("FLASK_DEBUG", "0") == "1"
    port = int(os.getenv("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=debug)
