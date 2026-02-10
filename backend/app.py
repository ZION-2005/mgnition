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

    if not top_reasons:
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
    rows = db.execute(
        """
        SELECT i.user_id, i.variant_key, i.answers_json, i.rule_score, i.served_at,
               EXISTS(
                 SELECT 1 FROM user_feedback f
                 WHERE f.user_id = i.user_id
                   AND f.variant_key = i.variant_key
                   AND f.event_type = 'save'
                   AND f.created_at >= i.served_at
               ) AS has_save,
               EXISTS(
                 SELECT 1 FROM user_feedback f
                 WHERE f.user_id = i.user_id
                   AND f.variant_key = i.variant_key
                   AND f.event_type = 'booking'
                   AND f.created_at >= i.served_at
               ) AS has_booking
        FROM recommendation_impressions i
        WHERE i.user_id IS NOT NULL
        """
    ).fetchall()

    if len(rows) < min_samples:
        db.close()
        return {"trained": False, "reason": f"need at least {min_samples} samples", "samples": len(rows)}

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
        has_save = int(r["has_save"] or 0) == 1
        has_booking = int(r["has_booking"] or 0) == 1
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

    token = get_token_from_header()
    user = get_user_by_token(token)
    user_id = user["id"] if user else None
    if user_id and isinstance(answers, dict):
        upsert_profile(user_id, answers)

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
                "reason": "Hybrid ranking from quiz + behavior learning",
                "explanation": r.get("explanation", {}),
                "rule_breakdown": r.get("rule_breakdown", {}),
            }
        )

    return jsonify({"recommendations": out})


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
