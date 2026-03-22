import json
import os
import secrets
import smtplib
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
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

    from cosine_recommender import apply_choice_conversions
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
MODEL_PATH = BASE_DIR / "models" / "recommender.joblib"
SURVEY_REG_MODEL_PATH = BASE_DIR / "models" / "survey_regression.joblib"
SURVEY_REG_BLEND_WEIGHT = float(os.getenv("SURVEY_REG_BLEND_WEIGHT", "0.15"))
BUDGET_RELAX_RATIO = float(os.getenv("BUDGET_RELAX_RATIO", "0.10"))
BUDGET_RELAX_MAX_THB = float(os.getenv("BUDGET_RELAX_MAX_THB", "200000"))
FEEDBACK_MIN_SAMPLES = int(os.getenv("FEEDBACK_MIN_SAMPLES", "20"))
FEEDBACK_BLEND_MIN = float(os.getenv("FEEDBACK_BLEND_MIN", "0.18"))
FEEDBACK_BLEND_MAX = float(os.getenv("FEEDBACK_BLEND_MAX", "0.40"))
FEEDBACK_BLEND_WARMUP_SAMPLES = int(os.getenv("FEEDBACK_BLEND_WARMUP_SAMPLES", "250"))


def resolve_variant_data_path():
    env_path = os.getenv("MGNITION_VARIANT_DATA_PATH", "").strip()
    candidates = []
    if env_path:
        p = Path(env_path).expanduser()
        if not p.is_absolute():
            p = (BASE_DIR / p).resolve()
        candidates.append(p)

    candidates.extend(
        [
            BASE_DIR / "data" / "modelVariants.json",
            BASE_DIR.parent / "mgnition-frontend" / "src" / "data" / "modelVariants.json",
        ]
    )

    for p in candidates:
        if p.exists():
            return p
    return candidates[0]


VARIANT_DATA_PATH = resolve_variant_data_path()


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
                booking_reference TEXT UNIQUE,
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
                booking_reference TEXT UNIQUE,
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
    if not column_exists(db, "bookings", "booking_reference"):
        db.execute("ALTER TABLE bookings ADD COLUMN booking_reference TEXT")

    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_reference ON bookings (booking_reference)")

    if USE_POSTGRES:
        ensure_pg_id_sequence_default(db, "promotions")
        ensure_pg_id_sequence_default(db, "bookings")
        ensure_pg_id_sequence_default(db, "best_sellers")

    db.execute("DROP TABLE IF EXISTS admin_models")

    missing_booking_refs = db.execute(
        "SELECT id FROM bookings WHERE booking_reference IS NULL OR booking_reference = ''"
    ).fetchall()
    for row in missing_booking_refs:
        db.execute(
            "UPDATE bookings SET booking_reference = ? WHERE id = ?",
            (generate_booking_reference(db), row["id"]),
        )

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


def generate_booking_reference(db):
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    while True:
        candidate = f"MGN-{today}-{secrets.token_hex(2).upper()}"
        exists = db.execute("SELECT 1 FROM bookings WHERE booking_reference = ? LIMIT 1", (candidate,)).fetchone()
        if not exists:
            return candidate


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


def smtp_settings():
    smtp_host = os.getenv("SMTP_HOST")
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_from = os.getenv("SMTP_FROM", smtp_user or "noreply@mgnition.local")
    if not smtp_host or not smtp_user or not smtp_pass:
        return None
    return {
        "host": smtp_host,
        "user": smtp_user,
        "pass": smtp_pass,
        "port": smtp_port,
        "from": smtp_from,
    }


def resend_settings():
    api_key = clean_str(os.getenv("RESEND_API_KEY"))
    from_email = clean_str(os.getenv("RESEND_FROM"))
    reply_to = clean_str(os.getenv("RESEND_REPLY_TO"))
    if not api_key or not from_email:
        return None
    return {"api_key": api_key, "from": from_email, "reply_to": reply_to}


def send_plain_email_via_resend(to_email, subject, body):
    cfg = resend_settings()
    if not cfg:
        return {"sent": False, "reason": "resend_not_configured"}

    payload = {"from": cfg["from"], "to": [to_email], "subject": subject, "text": body}
    if cfg["reply_to"]:
        payload["reply_to"] = cfg["reply_to"]

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {cfg['api_key']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            status = getattr(resp, "status", 200)
            raw = resp.read().decode("utf-8", "ignore")
        if 200 <= status < 300:
            out = {}
            try:
                out = json.loads(raw) if raw else {}
            except Exception:
                out = {}
            return {"sent": True, "provider": "resend", "id": out.get("id")}
        return {"sent": False, "reason": "resend_send_failed", "status": status}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "ignore")
        return {"sent": False, "reason": "resend_send_failed", "status": e.code, "error": raw[:300]}
    except Exception as e:
        return {"sent": False, "reason": "resend_send_failed", "error": str(e)}


def send_plain_email_via_smtp(to_email, subject, body):
    smtp = smtp_settings()
    if not smtp:
        return {"sent": False, "reason": "smtp_not_configured"}

    msg = MIMEText(body, "plain")
    msg["Subject"] = subject
    msg["From"] = smtp["from"]
    msg["To"] = to_email

    try:
        with smtplib.SMTP(smtp["host"], smtp["port"]) as server:
            server.starttls()
            server.login(smtp["user"], smtp["pass"])
            server.sendmail(smtp["from"], [to_email], msg.as_string())
        return {"sent": True, "provider": "smtp"}
    except Exception as e:
        return {"sent": False, "reason": "smtp_send_failed", "error": str(e)}


def send_plain_email(to_email, subject, body):
    to_email = clean_str(to_email)
    if not to_email:
        return {"sent": False, "reason": "missing_recipient"}

    # Use Resend first (works on free hosts that block SMTP ports), then fallback to SMTP.
    via_resend = send_plain_email_via_resend(to_email, subject, body)
    if via_resend.get("sent"):
        return via_resend

    via_smtp = send_plain_email_via_smtp(to_email, subject, body)
    if via_smtp.get("sent"):
        return via_smtp

    if via_resend.get("reason") == "resend_not_configured" and via_smtp.get("reason") == "smtp_not_configured":
        return {"sent": False, "reason": "email_not_configured"}

    return {"sent": False, "reason": "email_send_failed", "resend": via_resend, "smtp": via_smtp}


def send_password_reset_email(to_email, token):
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    reset_link = f"{frontend_url}/reset-password?token={token}"
    body = f"Use this link to reset your MGNITION password:\n\n{reset_link}\n\nThis link expires in 30 minutes."
    delivery = send_plain_email(to_email, "MGNITION password reset", body)
    if delivery.get("sent"):
        return {"sent": True, "reset_link": reset_link}
    # Keep dev fallback behavior for local testing when SMTP is absent.
    if delivery.get("reason") in {"smtp_not_configured", "resend_not_configured", "email_not_configured"}:
        return {"sent": False, "dev_token": token, "reset_link": reset_link}
    delivery["reset_link"] = reset_link
    return delivery


def send_booking_accepted_email(booking_row):
    to_email = clean_str((booking_row or {}).get("user_email"))
    model = clean_str((booking_row or {}).get("model"))
    variant = clean_str((booking_row or {}).get("variant"))
    showroom_name = clean_str((booking_row or {}).get("showroom_name"))
    showroom_address = clean_str((booking_row or {}).get("showroom_address"))
    user_name = clean_str((booking_row or {}).get("user_name"))
    created_at = clean_str((booking_row or {}).get("created_at"))
    booking_reference = clean_str((booking_row or {}).get("booking_reference"))

    line_reference = f"Booking ID: {booking_reference}\n" if booking_reference else ""
    line_variant = f"Variant: {variant}\n" if variant else ""
    line_address = f"Address: {showroom_address}\n" if showroom_address else ""
    line_name = f"Hi {user_name},\n\n" if user_name else ""
    body = (
        f"{line_name}"
        "Your MGNITION showroom booking has been approved.\n\n"
        f"{line_reference}"
        f"Model: {model or 'N/A'}\n"
        f"{line_variant}"
        f"Showroom: {showroom_name or 'N/A'}\n"
        f"{line_address}"
        f"Booked At: {created_at or 'N/A'}\n\n"
        "Our team will contact you shortly. Thank you for using MGNITION."
    )
    return send_plain_email(to_email, "MGNITION booking confirmation", body)


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


def get_all_variants():
    return BASE_VARIANTS


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


def _fuel_preference_label(v):
    t = normalize_text(v)
    if not t:
        return ""
    if ("ev" in t or "electric" in t) and ("hev" not in t and "hybrid" not in t):
        return "ev"
    if "hybrid" in t or "hev" in t or "phev" in t:
        return "hybrid"
    if "petrol" in t or "gasoline" in t or "diesel" in t or "gas" in t:
        return "ice"
    return ""


def _fuel_specific_label(v):
    t = normalize_text(v)
    if not t:
        return ""
    has_diesel = "diesel" in t
    has_petrol = "petrol" in t or "gasoline" in t
    if has_diesel and has_petrol:
        return ""
    if "diesel" in t:
        return "diesel"
    if "petrol" in t or "gasoline" in t:
        return "petrol"
    if ("ev" in t or "electric" in t) and ("hev" not in t and "hybrid" not in t):
        return "ev"
    if "hybrid" in t or "hev" in t or "phev" in t:
        return "hybrid"
    return ""


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

    fuel_pref = _fuel_preference_label(answers.get("fuelType") or answers.get("fuel_type") or answers.get("fuel"))
    fuel_choice = _fuel_specific_label(answers.get("fuelType") or answers.get("fuel_type") or answers.get("fuel"))

    out = {
        "budget_choice": budget_choice,
        "seat_choice": seat_choice,
        "fuel_type_EV": fuel_type_ev,
        "fuel_preference": fuel_pref,
        "fuel_choice": fuel_choice,
        "occupation": occupation,
        "hobbies": hobbies,
        "usage": usage,
        "daily_distance": daily_distance,
    }

    if answers.get("max_price_thb") is not None:
        out["max_price_thb"] = safe_float(answers.get("max_price_thb"), None)
    if answers.get("min_price_thb") is not None:
        out["min_price_thb"] = safe_float(answers.get("min_price_thb"), None)
    if answers.get("min_seats") is not None:
        out["min_seats"] = int(safe_float(answers.get("min_seats"), 0) or 0)
    if answers.get("max_seats") is not None:
        out["max_seats"] = int(safe_float(answers.get("max_seats"), 0) or 0)
    return out


def canonical_survey_choice_label(text):
    s = normalize_text(text)
    if not s:
        return None
    if "mg 3 hybrid" in s:
        return "mg3_hybrid"
    if "s5 ev" in s:
        return "mgs5_ev_plus"
    if "vs hev" in s:
        return "mg_vs_hev"
    if "mg es" in s:
        return "mg_es"
    if "mg hs" in s and "phev" not in s:
        return "mg_hs"
    return None


def canonical_survey_choice_for_car(car_row):
    model = normalize_text(car_row.get("model"))
    variant = normalize_text(car_row.get("variant"))
    fuel_type = normalize_text(car_row.get("fuel_type"))
    joined = f"{model} {variant} {fuel_type}".strip()
    return canonical_survey_choice_label(joined)


def survey_regression_features_from_answers(answers):
    feat = {}

    def _push(prefix, value):
        v = normalize_text(value)
        if v:
            feat[f"{prefix}::{v}"] = 1

    _push("occupation", answers.get("occupation"))
    _push("budget", answers.get("budget_choice") or answers.get("budget"))
    _push("seats", answers.get("seat_choice") or answers.get("seats"))
    _push("fuel", answers.get("fuelType") or answers.get("fuel_type") or answers.get("fuel"))
    _push("distance", answers.get("daily_distance") or answers.get("distance"))

    usage_val = answers.get("usage")
    usage_items = _as_list(usage_val)
    for item in usage_items:
        _push("usage", item)

    hobbies_items = _as_list(answers.get("hobbies"))
    for item in hobbies_items:
        _push("hobby", item)

    return feat


def load_survey_regression_artifact():
    if not SKLEARN_AVAILABLE or not SURVEY_REG_MODEL_PATH.exists():
        return None
    try:
        artifact = joblib.load(SURVEY_REG_MODEL_PATH)
        if not artifact or not artifact.get("vectorizer") or not artifact.get("model"):
            return None
        return artifact
    except Exception:
        return None


def survey_regression_probs(answers):
    artifact = SURVEY_REG_ARTIFACT
    if not artifact:
        return {}
    try:
        feat = survey_regression_features_from_answers(answers)
        X = artifact["vectorizer"].transform([feat])
        probs = artifact["model"].predict_proba(X)[0]
        classes = list(artifact["model"].classes_)
        return {str(classes[i]): float(probs[i]) for i in range(len(classes))}
    except Exception:
        return {}


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


def _is_ev_fuel(fuel_text):
    t = normalize_text(fuel_text)
    return ("ev" in t or "electric" in t) and ("hybrid" not in t and "hev" not in t and "phev" not in t)


def _is_hybrid_fuel(fuel_text):
    t = normalize_text(fuel_text)
    return "hybrid" in t or "hev" in t or "phev" in t or "plug-in hybrid" in t


def _is_ice_fuel(fuel_text):
    t = normalize_text(fuel_text)
    return "petrol" in t or "gasoline" in t or "gas" in t or "diesel" in t


def _budget_matches_for_reason(price, answers):
    p = safe_float(price, 0)
    if p <= 0:
        return False

    min_price = answers.get("min_price_thb")
    max_price = answers.get("max_price_thb")
    min_price_val = safe_float(min_price, None) if min_price is not None else None
    max_price_val = safe_float(max_price, None) if max_price is not None else None

    if min_price_val is not None and p < min_price_val:
        return False
    if max_price_val is not None and p > max_price_val:
        return False

    budget_text = normalize_text(answers.get("budget_choice") or answers.get("budget"))
    if not budget_text:
        return min_price_val is not None or max_price_val is not None
    if "below 700" in budget_text:
        return p <= 700000
    if "700,000" in budget_text and "999" in budget_text:
        return 700000 <= p <= 999999
    if "1,000,000" in budget_text:
        return 1000000 <= p <= 1299999
    if "1,300,000" in budget_text:
        return p >= 1300000
    return True


def _seat_matches_for_reason(seats, answers):
    s = int(safe_float(seats, 0) or 0)
    if s <= 0:
        return False
    seat_choice = normalize_text(answers.get("seat_choice") or answers.get("seats"))
    if not seat_choice:
        return False
    if "2" in seat_choice and "seat" in seat_choice:
        return s == 2
    if "3-5" in seat_choice:
        return 3 <= s <= 5
    if "5+" in seat_choice or "5" in seat_choice:
        return s >= 5
    return False


def _distance_matches_for_reason(range_km, answers):
    r = safe_float(range_km, 0)
    if r <= 0:
        return False
    distance = normalize_text(answers.get("daily_distance") or answers.get("distance"))
    if not distance:
        return False
    if "very long" in distance:
        return r >= 500
    if "long" in distance:
        return r >= 420
    if "medium" in distance:
        return r >= 350
    if "short" in distance:
        return r >= 250
    return False


def _fuel_matches_for_reason(car_fuel, answers):
    fuel_pref = normalize_text(answers.get("fuelType") or answers.get("fuel_type") or answers.get("fuel"))
    if not fuel_pref:
        return False
    car_fuel_text = normalize_text(car_fuel)
    if ("diesel" in fuel_pref) and ("petrol" in fuel_pref or "gasoline" in fuel_pref):
        return _is_ice_fuel(car_fuel_text)
    if "diesel" in fuel_pref:
        return "diesel" in car_fuel_text
    if "petrol" in fuel_pref or "gasoline" in fuel_pref:
        return "petrol" in car_fuel_text or "gasoline" in car_fuel_text or "gas" in car_fuel_text
    if ("ev" in fuel_pref or "electric" in fuel_pref) and ("hybrid" not in fuel_pref and "hev" not in fuel_pref):
        return _is_ev_fuel(car_fuel_text)
    if "hybrid" in fuel_pref or "hev" in fuel_pref or "phev" in fuel_pref:
        return _is_hybrid_fuel(car_fuel_text)
    if "petrol/diesel" in fuel_pref or "ice" in fuel_pref:
        return _is_ice_fuel(car_fuel_text)
    return False


def _body_usage_match_for_reason(key, car_row, answers):
    usage_raw = answers.get("usage")
    usage_text = normalize_text(" ".join(_as_list(usage_raw)) if isinstance(usage_raw, list) else usage_raw)
    body_type = normalize_text(car_row.get("body_type"))
    cargo = safe_float(car_row.get("cargo_liters"), 0)
    hp = safe_float(car_row.get("horsepower_hp"), 0)
    rng = safe_float(car_row.get("range_km"), 0)
    fuel = normalize_text(car_row.get("fuel_type"))

    if key == "cargo_weight":
        return "cargo" in usage_text and cargo >= 400
    if key == "efficiency_weight":
        return "eco" in usage_text and (_is_ev_fuel(fuel) or _is_hybrid_fuel(fuel))
    if key == "suv_pref":
        is_suv_body = body_type in ("suv", "pickup", "mpv", "crossover")
        return is_suv_body and ("cargo" in usage_text or "highway" in usage_text)
    if key == "sedan_pref":
        is_city_body = body_type in ("sedan", "hatchback", "wagon")
        return is_city_body and "city" in usage_text
    if key == "hp_weight":
        occupation = normalize_text(answers.get("occupation"))
        return hp >= 150 and (occupation in ("working professional", "business owner") or "highway" in usage_text)
    if key == "torque_weight":
        torque = safe_float(car_row.get("torque_nm"), 0)
        return torque >= 220 and ("highway" in usage_text or "cargo" in usage_text)
    return False


def _cosine_reason_detail(key, car_row, answers):
    budget_choice = clean_str(answers.get("budget_choice") or answers.get("budget"))
    seat_choice = clean_str(answers.get("seat_choice") or answers.get("seats"))
    distance_choice = clean_str(answers.get("daily_distance") or answers.get("distance"))
    fuel_choice = clean_str(answers.get("fuelType") or answers.get("fuel_type") or answers.get("fuel"))
    usage_raw = answers.get("usage")
    if isinstance(usage_raw, list):
        usage_choice = ", ".join([clean_str(x) for x in usage_raw if clean_str(x)])
    else:
        usage_choice = clean_str(usage_raw)
    occupation_choice = clean_str(answers.get("occupation"))

    fuel_type = clean_str(car_row.get("fuel_type")) or "N/A"
    body_type = clean_str(car_row.get("body_type")) or "N/A"
    price = safe_float(car_row.get("price_thb"), 0)
    seats = int(safe_float(car_row.get("seats"), 0) or 0)
    range_km = int(safe_float(car_row.get("range_km"), 0) or 0)
    cargo_liters = int(safe_float(car_row.get("cargo_liters"), 0) or 0)

    if key == "price_weight":
        if _budget_matches_for_reason(price, answers):
            if budget_choice:
                return f"This car fits the budget range you selected ({budget_choice}) with a starting price of {fmt_price(price)}."
            return f"This car fits your budget preference with a starting price of {fmt_price(price)}."
        return None
    if key == "seats_weight":
        if _seat_matches_for_reason(seats, answers):
            if seat_choice:
                return f"The seat capacity matches what you asked for ({seat_choice}) and this car has {seats} seats."
            return f"The seat capacity matches your quiz preference with {seats} seats."
        return None
    if key == "range_weight":
        if _distance_matches_for_reason(range_km, answers):
            if distance_choice:
                return f"The driving range suits your daily travel pattern ({distance_choice}) with about {range_km} km range."
            return f"The driving range suits your daily travel pattern with about {range_km} km range."
        return None
    if key == "cargo_weight":
        if _body_usage_match_for_reason("cargo_weight", car_row, answers):
            if usage_choice:
                return f"The cargo space supports how you'll use the car ({usage_choice}) with around {cargo_liters} L."
            return f"The cargo space supports your expected usage with around {cargo_liters} L."
        return None
    if key == "hp_weight":
        if _body_usage_match_for_reason("hp_weight", car_row, answers):
            hp = int(safe_float(car_row.get("horsepower_hp"), 0) or 0)
            if occupation_choice:
                return f"The performance level matches your driving profile ({occupation_choice}) with {hp} hp."
            return f"The performance level matches your driving profile with {hp} hp."
        return None
    if key == "torque_weight":
        if _body_usage_match_for_reason("torque_weight", car_row, answers):
            torque = int(safe_float(car_row.get("torque_nm"), 0) or 0)
            if usage_choice:
                return f"The acceleration/torque feel matches your use case ({usage_choice}) with {torque} Nm."
            return f"The acceleration/torque feel matches your use case with {torque} Nm."
        return None
    if key in ("fuel_ev_weight", "fuel_hev_weight", "fuel_ice_weight"):
        if _fuel_matches_for_reason(fuel_type, answers):
            if fuel_choice:
                return f"The fuel type matches what you selected ({fuel_choice}) and this model is {fuel_type}."
            return f"The fuel type matches your preference and this model is {fuel_type}."
        return None
    if key == "efficiency_weight":
        if _body_usage_match_for_reason("efficiency_weight", car_row, answers):
            if usage_choice:
                return f"This model's efficiency fits your driving style ({usage_choice})."
            return "This model's efficiency fits your driving style."
        return None
    if key == "suv_pref":
        if _body_usage_match_for_reason("suv_pref", car_row, answers):
            if usage_choice:
                return f"The body style matches how you plan to drive ({usage_choice}) and this car is a {body_type}."
            return f"The body style matches your preference and this car is a {body_type}."
        return None
    if key == "sedan_pref":
        if _body_usage_match_for_reason("sedan_pref", car_row, answers):
            if usage_choice:
                return f"The body style matches how you plan to drive ({usage_choice}) and this car is a {body_type}."
            return f"The body style matches your preference and this car is a {body_type}."
        return None
    return None


def build_cosine_explanation(car_row, user_profile, final_score, answers=None):
    contributions = []
    for key in COSINE_FEATURE_ORDER:
        u = safe_float(user_profile.get(key), 0)
        c = safe_float(car_row.get(key), 0)
        contributions.append((key, u * c))
    contributions.sort(key=lambda x: x[1], reverse=True)

    ranked = [(k, v) for k, v in contributions if v > 0]
    factors = []
    seen_details = set()
    for key, val in ranked:
        label = COSINE_REASON_LABELS.get(key, key)
        detail = _cosine_reason_detail(key, car_row, answers or {})
        if not detail:
            continue
        normalized_detail = normalize_text(detail)
        if normalized_detail in seen_details:
            continue
        seen_details.add(normalized_detail)
        factors.append(
            {
                "key": key,
                "label": label,
                "points": round(float(val), 4),
                "detail": detail,
            }
        )

    ordered_reason_lines = [f["detail"] for f in factors]
    top_reasons = ordered_reason_lines[:3]
    more_reasons = ordered_reason_lines[3:8]
    if not top_reasons:
        top_reasons = ["Matched overall preferences from your quiz."]

    return {
        "top_reasons": top_reasons,
        "more_reasons": more_reasons,
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
    budget_label = clean_str(answers.get("budget_choice") or answers.get("budget"))
    max_price = answers.get("max_price_thb")
    min_price = answers.get("min_price_thb")
    if max_price is not None or min_price is not None:
        max_price_val = safe_float(max_price, None) if max_price is not None else None
        min_price_val = safe_float(min_price, None) if min_price is not None else None
        price_ok = bool(price)
        if price_ok and max_price_val is not None:
            price_ok = price <= max_price_val
        if price_ok and min_price_val is not None:
            price_ok = price >= min_price_val
        if price_ok:
            reasons.append(f"Budget fit: You selected ({budget_label or 'custom budget'}), and this car is {fmt_price(price)}.")
    elif budget_text:
        if "below 700" in budget_text and price and price <= 700000:
            reasons.append(f"Budget fit: You selected ({budget_label or 'Below 700,000 THB'}), and this car is {fmt_price(price)}.")
        elif "700,000" in budget_text and "999" in budget_text and 700000 <= price <= 999999:
            reasons.append(f"Budget fit: You selected ({budget_label or '700,000 - 999,999 THB'}), and this car is {fmt_price(price)}.")
        elif "1,000,000" in budget_text and 1000000 <= price <= 1299999:
            reasons.append(f"Budget fit: You selected ({budget_label or '1,000,000 - 1,299,999 THB'}), and this car is {fmt_price(price)}.")
        elif "1,300,000" in budget_text and price >= 1300000:
            reasons.append(f"Budget fit: You selected ({budget_label or '1,300,000 THB and above'}), and this car is {fmt_price(price)}.")

    seat_choice = normalize_text(answers.get("seat_choice") or answers.get("seats"))
    seat_label = clean_str(answers.get("seat_choice") or answers.get("seats"))
    if seat_choice:
        if "2" in seat_choice and "seat" in seat_choice and seats == 2:
            reasons.append(f"Seat fit: You selected ({seat_label or '2 seats'}), and this car has {seats} seats.")
        elif "3-5" in seat_choice and 3 <= seats <= 5:
            reasons.append(f"Seat fit: You selected ({seat_label or '3-5 seats'}), and this car has {seats} seats.")
        elif ("5+" in seat_choice or "5" in seat_choice) and seats >= 5:
            reasons.append(f"Seat fit: You selected ({seat_label or '5+ seats'}), and this car has {seats} seats.")

    fuel_pref = normalize_text(answers.get("fuelType") or answers.get("fuel_type") or answers.get("fuel"))
    if fuel_pref:
        fuel_match = fuel_pref.split(" ")[0] in fuel_type
        if fuel_pref.startswith("ev") and "ev" in fuel_type and "hybrid" not in fuel_type:
            fuel_match = True
        if fuel_pref.startswith("hybrid") and "hybrid" in fuel_type:
            fuel_match = True
        if fuel_match:
            label = clean_str(answers.get("fuelType") or answers.get("fuel_type") or answers.get("fuel"))
            reasons.append(f"Fuel fit: You selected ({label or 'fuel preference'}), and this car is {variant.get('fuel_type') or 'compatible'}.")

    if len(reasons) < 3:
        distance = normalize_text(answers.get("daily_distance") or answers.get("distance"))
        distance_label = clean_str(answers.get("daily_distance") or answers.get("distance"))
        range_km = int(safe_float(variant.get("range_km"), 0) or 0)
        distance_ok = False
        if "very long" in distance:
            distance_ok = range_km >= 500
        elif "long" in distance:
            distance_ok = range_km >= 420
        elif "medium" in distance:
            distance_ok = range_km >= 350
        elif "short" in distance:
            distance_ok = range_km >= 250
        if distance_ok and range_km:
            reasons.append(f"Range fit: You selected ({distance_label or 'daily distance'}), and this model supports about {range_km} km.")

    if len(reasons) < 3:
        usage_val = answers.get("usage")
        if isinstance(usage_val, list):
            usage_val = " ".join([clean_str(x) for x in usage_val if clean_str(x)])
        usage = normalize_text(usage_val)
        cargo = int(safe_float(variant.get("cargo_liters"), 0) or 0)
        body = normalize_text(variant.get("body_type"))
        if "cargo" in usage and cargo >= 400:
            reasons.append(f"Usage fit: You selected ({clean_str(usage_val)}), and cargo space is {cargo} L.")
        elif "city" in usage and body:
            reasons.append(f"Usage fit: You selected ({clean_str(usage_val)}), and this car body type is {variant.get('body_type')}.")

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
SURVEY_REG_ARTIFACT = load_survey_regression_artifact()


def feedback_blend_weight(artifact):
    if not artifact:
        return 0.0
    samples = int(safe_float(artifact.get("samples"), 0) or 0)
    positives = int(safe_float(artifact.get("positives"), 0) or 0)
    if samples < max(1, FEEDBACK_MIN_SAMPLES) or positives <= 0:
        return 0.0

    min_w = max(0.0, min(0.8, safe_float(FEEDBACK_BLEND_MIN, 0.18)))
    max_w = max(min_w, min(0.9, safe_float(FEEDBACK_BLEND_MAX, 0.40)))
    warmup = max(FEEDBACK_MIN_SAMPLES + 1, int(safe_float(FEEDBACK_BLEND_WARMUP_SAMPLES, 250) or 250))
    progress = (samples - FEEDBACK_MIN_SAMPLES) / float(max(1, warmup - FEEDBACK_MIN_SAMPLES))
    progress = max(0.0, min(1.0, progress))
    return min_w + (max_w - min_w) * progress


def predict_feedback_score(artifact, variant, answers, cosine_score=0.0):
    if not artifact:
        return None
    try:
        base_rule = max(0.0, min(12.0, float(safe_float(cosine_score, 0.0)) * 12.0))
        feat = featurize(variant, answers, base_rule)
        X = artifact["vectorizer"].transform([feat])
        return float(artifact["model"].predict_proba(X)[0][1])
    except Exception:
        return None


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
        SELECT user_id, variant_key, event_type, created_at, payload_json
        FROM user_feedback
        WHERE event_type IN ('save', 'booking', 'rating')
        """
    ).fetchall()

    feedback_map = {}
    for f in feedback_rows:
        key = (f["user_id"], f["variant_key"])
        bucket = feedback_map.setdefault(key, {"save": [], "booking": [], "rating": []})
        ts = parse_iso(f["created_at"])
        if ts and f["event_type"] in bucket:
            if f["event_type"] == "rating":
                rating_val = None
                try:
                    payload = json.loads(f["payload_json"] or "{}")
                    rating_raw = safe_float(payload.get("rating"), None) if isinstance(payload, dict) else None
                    if rating_raw is not None:
                        rating_val = max(1.0, min(5.0, float(rating_raw)))
                except Exception:
                    rating_val = None
                bucket["rating"].append((ts, rating_val))
            else:
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
        fb = feedback_map.get((r["user_id"], r["variant_key"]), {"save": [], "booking": [], "rating": []})
        has_save = any(ts and served and ts >= served for ts in fb.get("save", []))
        has_booking = any(ts and served and ts >= served for ts in fb.get("booking", []))
        ratings_after = [
            rv
            for ts, rv in fb.get("rating", [])
            if ts and served and ts >= served and rv is not None
        ]
        avg_rating = (sum(ratings_after) / len(ratings_after)) if ratings_after else None
        has_high_rating = any(rv >= 4.0 for rv in ratings_after)
        has_low_rating = any(rv <= 2.0 for rv in ratings_after)

        if has_booking or has_save or has_high_rating:
            label = 1
        elif has_low_rating:
            label = 0
        elif avg_rating is not None:
            label = 1 if avg_rating >= 3.5 else 0
        else:
            label = 0
        ys.append(label)
        if has_booking:
            sample_weight = 3.0
        elif has_save:
            sample_weight = 2.0
        elif avg_rating is not None:
            # Ratings closer to extremes carry more learning signal.
            sample_weight = 1.0 + abs(avg_rating - 3.0) * 0.6
        else:
            sample_weight = 1.0
        ws.append(sample_weight)

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


def row_get(row, key, default=None):
    if row is None:
        return default
    try:
        if key in row.keys():
            return row[key]
    except Exception:
        pass
    try:
        return row.get(key, default)
    except Exception:
        return default


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
                "/feedback/rating",
                "/recommend",
                "/public/promotions",
                "/public/car-of-the-month",
                "/admin/analytics",
                "/admin/bookings",
                "/admin/promotions",
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
    quiz_answers = payload.get("quiz_answers") if "quiz_answers" in payload else None
    if quiz_answers is not None and not isinstance(quiz_answers, dict):
        return jsonify({"error": "quiz_answers must be an object."}), 400

    editable_fields = {key for key in ("full_name", "email", "phone") if key in payload}
    if quiz_answers is None and not editable_fields:
        return jsonify({"error": "No profile updates provided."}), 400

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (g.current_user["id"],)).fetchone()
    if not user:
        return jsonify({"error": "User not found."}), 404

    next_full_name = clean_str(payload.get("full_name")) if "full_name" in payload else clean_str(user["full_name"])
    next_email = clean_str(payload.get("email")).lower() if "email" in payload else clean_str(user["email"]).lower()
    next_phone = clean_str(payload.get("phone")) if "phone" in payload else clean_str(user["phone"])

    if not next_full_name:
        return jsonify({"error": "Full name is required."}), 400
    if not next_email or "@" not in next_email:
        return jsonify({"error": "Please provide a valid email address."}), 400

    existing_email = db.execute("SELECT id FROM users WHERE email = ? AND id <> ?", (next_email, user["id"])).fetchone()
    if existing_email:
        return jsonify({"error": "Email already registered."}), 409

    db.execute(
        "UPDATE users SET full_name = ?, email = ?, phone = ? WHERE id = ?",
        (next_full_name, next_email, next_phone, user["id"]),
    )
    db.execute(
        "UPDATE bookings SET user_name = ?, user_email = ?, user_phone = ? WHERE user_id = ?",
        (next_full_name, next_email, next_phone, user["id"]),
    )
    db.commit()

    if quiz_answers is not None:
        upsert_profile(user["id"], quiz_answers)

    updated_user = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    return jsonify(
        {
            "message": "Profile updated.",
            "user": user_payload(updated_user),
            "profile": get_profile(user["id"]),
        }
    )


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


@app.post("/feedback/rating")
@auth_required
def feedback_rating():
    payload = request.get_json(silent=True) or {}
    vk = clean_str(payload.get("variant_key"))
    model = clean_str(payload.get("model"))
    if not vk:
        vk = variant_key_from_values(model, payload.get("variant"), payload.get("year"))
    if not vk:
        return jsonify({"error": "variant_key or model is required."}), 400

    rating = safe_float(payload.get("rating"), None)
    if rating is None:
        return jsonify({"error": "rating is required."}), 400
    rating = max(1.0, min(5.0, float(rating)))

    event_payload = dict(payload)
    event_payload["rating"] = rating
    insert_feedback(g.current_user["id"], vk, "rating", event_payload)
    train_from_feedback(min_samples=20)
    return jsonify({"message": "Rating feedback logged.", "rating": rating})


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
    booking_reference = generate_booking_reference(db)
    db.execute(
        """
        INSERT INTO bookings
        (booking_reference, user_id, user_name, user_email, user_phone, showroom_id, showroom_name, showroom_address, province, model, variant, variant_key, notes, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        """,
        (
            booking_reference,
            g.current_user["id"],
            clean_str(payload.get("user_name")) or clean_str(row_get(g.current_user, "full_name")),
            clean_str(payload.get("user_email")) or clean_str(row_get(g.current_user, "email")),
            clean_str(payload.get("user_phone")) or clean_str(row_get(g.current_user, "phone")),
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
    booking_row = db.execute(
        """
        SELECT id, booking_reference, user_id, user_name, user_email, user_phone, showroom_id, showroom_name, showroom_address,
               province, model, variant, variant_key, notes, status, created_at
        FROM bookings
        WHERE booking_reference = ?
        """,
        (booking_reference,),
    ).fetchone()

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

    return jsonify({"message": "Booking created successfully.", "booking": dict(booking_row) if booking_row else None}), 201


@app.post("/recommend")
def recommend():
    answers = request.get_json(silent=True) or {}
    if not isinstance(answers, dict):
        answers = {}

    # Enforce cosine-only recommendations so hard constraints are always applied.
    if not COSINE_AVAILABLE:
        return (
            jsonify(
                {
                    "recommendations": [],
                    "engine": "cosine_similarity",
                    "message": "Cosine engine is unavailable. Install backend requirements and restart with scripts/run_backend.sh.",
                    "cosine_error": COSINE_IMPORT_ERROR or "unknown import error",
                }
            ),
            503,
        )

    token = get_token_from_header()
    user = get_user_by_token(token)
    user_id = user["id"] if user else None
    if user_id and isinstance(answers, dict):
        upsert_profile(user_id, answers)

    top = []
    car_df = pd.DataFrame(get_all_variants())
    base_cosine_input = apply_choice_conversions(map_answers_to_cosine_input(answers))
    relaxation_level = "strict"
    fallback_notice = ""
    target_top_k = 3

    def _min_required_range_km(distance_choice):
        d = normalize_text(distance_choice)
        if "very long" in d or "150+" in d:
            return 500
        if "long" in d:
            return 420
        if "medium" in d or "30-80" in d:
            return 350
        if "short" in d:
            return 250
        return 0

    def _seat_floor(choice_text):
        s = normalize_text(choice_text)
        if "5+" in s:
            return 5
        if "3-5" in s:
            return 3
        if "2" in s and "seat" in s:
            return 2
        return 0

    requested_seat_choice = clean_str(base_cosine_input.get("seat_choice"))
    seat_floor = _seat_floor(requested_seat_choice)
    min_required_range_km = _min_required_range_km(base_cosine_input.get("daily_distance"))

    def _apply_capability_floors(df):
        out = df.copy()
        if out.empty:
            return out
        if min_required_range_km > 0 and "range_km" in out.columns:
            ranges = pd.to_numeric(out["range_km"], errors="coerce")
            out = out.loc[ranges >= float(min_required_range_km)]
        if seat_floor > 0 and "seats" in out.columns:
            seats = pd.to_numeric(out["seats"], errors="coerce")
            out = out.loc[seats >= int(seat_floor)]
        return out

    def _relax_seats_keep_floor(x):
        out = dict(x)
        out["seat_choice"] = ""
        if seat_floor > 0:
            out["min_seats"] = int(seat_floor)
            out["max_seats"] = None
        else:
            out["min_seats"] = None
            out["max_seats"] = None
        return out

    def _relax_fuel(x):
        out = dict(x)
        out["fuel_choice"] = ""
        out["fuel_preference"] = ""
        out["fuel_type_EV"] = 0
        return out

    ordered_relaxations = [
        (
            "strict",
            "",
            lambda x: dict(x),
        ),
        (
            "relaxed_body_usage",
            "No exact top matches for selected body/usage profile. Showing closest cars in your budget.",
            lambda x: {
                **x,
                "hobbies": [],
                "usage": [],
            },
        ),
        (
            "relaxed_distance_range",
            "No exact top matches for selected distance/range profile. Showing closest cars in your budget while keeping minimum capability.",
            lambda x: {
                **x,
                "daily_distance": "",
            },
        ),
        (
            "relaxed_seat",
            "No exact top matches for selected seats. Showing cars with equal or higher seat capability in your budget.",
            _relax_seats_keep_floor,
        ),
        (
            "relaxed_fuel",
            "No exact top matches for selected fuel. Showing closest cars in your budget with equal or higher capability.",
            lambda x: _relax_fuel(_relax_seats_keep_floor(x)),
        ),
    ]

    selected_rows = []
    seen_variant_keys = set()
    user_profile = {}

    for stage_index, (level, note, transform) in enumerate(ordered_relaxations):
        trial_input = apply_choice_conversions(transform(dict(base_cosine_input)))
        trial_df, trial_profile, _trial_cols, trial_msg = score_cars_with_cosine(
            car_df,
            trial_input,
            debug=False,
        )
        if trial_msg or trial_df.empty:
            continue

        trial_df = _apply_capability_floors(trial_df)
        if trial_df.empty:
            continue

        trial_df = trial_df.sort_values("similarity_score", ascending=False)
        added_here = 0
        for _, row in trial_df.iterrows():
            row_dict = row.to_dict()
            variant_key = clean_str(row_dict.get("variant_key"))
            if not variant_key:
                variant_key = f"{clean_str(row_dict.get('model'))}|{clean_str(row_dict.get('variant'))}"
            if variant_key in seen_variant_keys:
                continue
            seen_variant_keys.add(variant_key)
            row_dict["relax_stage"] = stage_index
            row_dict["relax_level"] = level
            selected_rows.append(row_dict)
            added_here += 1
            if len(selected_rows) >= target_top_k:
                break

        if added_here > 0:
            user_profile = trial_profile or user_profile
            relaxation_level = level
            if level != "strict":
                fallback_notice = note

        if len(selected_rows) >= target_top_k:
            break

    if not selected_rows:
        return (
            jsonify(
                {
                    "recommendations": [],
                    "engine": "cosine_similarity",
                    "message": "No cars match your budget and minimum capability requirements. Try expanding budget or reducing required range/seats.",
                }
            ),
            200,
        )

    ranked_df = pd.DataFrame(selected_rows)

    reg_probs = survey_regression_probs(answers)
    reg_enabled = bool(reg_probs)
    # Keep regression as a small refinement layer only.
    blend_w = max(0.0, min(0.25, SURVEY_REG_BLEND_WEIGHT))
    ranked_df = ranked_df.copy()

    reg_scores = []
    survey_masks = []
    final_scores = []
    for _, row in ranked_df.iterrows():
        r = row.to_dict()
        cosine_score = float(safe_float(r.get("similarity_score"), 0))
        cls = canonical_survey_choice_for_car(r)
        reg_score = float(reg_probs.get(cls, 0.0)) if (reg_enabled and cls) else 0.0
        has_survey = bool(reg_enabled and cls)

        # Survey model only participates for covered classes; others stay neutral.
        if has_survey:
            w_cos = 1.0 - blend_w
            w_reg = blend_w
            denom = max(1e-9, w_cos + w_reg)
            final_score = (w_cos * cosine_score + w_reg * reg_score) / denom
        else:
            final_score = cosine_score

        reg_scores.append(reg_score)
        survey_masks.append(1 if has_survey else 0)
        final_scores.append(final_score)

    ranked_df["regression_score"] = reg_scores
    ranked_df["survey_mask"] = survey_masks
    ranked_df["feedback_score"] = 0.0
    ranked_df["final_score"] = final_scores
    feedback_enabled = False
    feedback_w = 0.0

    if "relax_stage" in ranked_df.columns:
        ranked_df = ranked_df.sort_values(["relax_stage", "final_score"], ascending=[True, False]).head(target_top_k)
    else:
        ranked_df = ranked_df.sort_values("final_score", ascending=False).head(target_top_k)

    def _safe_text(v):
        if v is None:
            return ""
        if isinstance(v, float) and v != v:
            return ""
        s = str(v).strip()
        return "" if s.lower() == "nan" else s

    for _, row in ranked_df.iterrows():
        r = row.to_dict()
        cosine_score = round(float(safe_float(r.get("similarity_score"), 0)), 6)
        reg_score = round(float(safe_float(r.get("regression_score"), 0)), 6)
        feedback_score = round(float(safe_float(r.get("feedback_score"), 0)), 6)
        score = round(float(safe_float(r.get("final_score"), cosine_score)), 6)
        explanation = build_cosine_explanation(r, user_profile, score, answers)
        reason_tokens = ["hard constraints", "cosine similarity"]
        if reg_enabled and int(safe_float(r.get("survey_mask"), 0) or 0) == 1 and blend_w > 0:
            reason_tokens.append("low-weight survey regression rerank")
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
                "rule_score": cosine_score,
                "ml_score": reg_score if (reg_enabled and int(safe_float(r.get("survey_mask"), 0) or 0) == 1) else None,
                "score": score,
                "cosine_score": cosine_score,
                "regression_score": reg_score,
                "feedback_score": 0.0,
                "reason": " + ".join(reason_tokens),
                "explanation": explanation,
                "rule_breakdown": {f["key"]: f["points"] for f in explanation.get("factors", [])},
            }
        )

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
                "cosine_score": r.get("cosine_score", r["score"]),
                "regression_score": r.get("regression_score", 0),
                "feedback_score": r.get("feedback_score", 0),
                "reason": r.get("reason") or "Cosine similarity + hard constraints",
                "explanation": r.get("explanation", {}),
                "rule_breakdown": r.get("rule_breakdown", {}),
            }
        )

    payload = {
        "recommendations": out,
        "engine": "cosine_similarity",
        "regression_enabled": reg_enabled,
        "feedback_enabled": False,
        "survey_weight": round(blend_w, 4),
        "feedback_weight": 0.0,
        "relaxation_level": relaxation_level,
    }
    if fallback_notice:
        payload["message"] = fallback_notice
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


@app.get("/public/car-of-the-month")
def public_car_of_the_month():
    now = utc_now()
    period = f"{now.year:04d}-{now.month:02d}"

    rows = get_db().execute(
        """
        SELECT variant_key, model, variant, year, created_at
        FROM saved_variants
        """
    ).fetchall()

    if not rows:
        return jsonify({"scope": "monthly", "period": period, "cars": []})

    month_counts = {}
    all_counts = {}
    row_meta = {}

    for r in rows:
        vk = clean_str(r["variant_key"]) or variant_key_from_values(r["model"], r["variant"], r["year"])
        if not vk:
            continue
        all_counts[vk] = all_counts.get(vk, 0) + 1
        if vk not in row_meta:
            row_meta[vk] = {
                "model": clean_str(r["model"]),
                "variant": clean_str(r["variant"]),
                "year": clean_str(r["year"]),
            }
        ts = parse_iso(r["created_at"])
        if ts and ts.year == now.year and ts.month == now.month:
            month_counts[vk] = month_counts.get(vk, 0) + 1

    counts = month_counts if month_counts else all_counts
    scope = "monthly" if month_counts else "all_time"
    vmap = variant_lookup()

    top_rows = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:1]
    cars = []
    for vk, cnt in top_rows:
        v = vmap.get(vk, {})
        meta = row_meta.get(vk, {})
        price_thb = safe_float(v.get("price_thb"), 0)
        price_label = fmt_price(price_thb) if price_thb else ""
        cars.append(
            {
                "variant_key": vk,
                "model": clean_str(v.get("model")) or meta.get("model", ""),
                "variant": clean_str(v.get("variant")) or meta.get("variant", ""),
                "year": clean_str(v.get("year")) or meta.get("year", ""),
                "price": price_label,
                "starting_price": price_label,
                "fuel": clean_str(v.get("fuel_type")),
                "seats": str(v.get("seats") or ""),
                "bodyType": clean_str(v.get("body_type")),
                "imagePageUrl": clean_str(v.get("image_url")),
                "save_count": int(cnt),
            }
        )

    return jsonify({"scope": scope, "period": period, "cars": cars})


@app.get("/admin/analytics")
@admin_required
def admin_analytics():
    db = get_db()
    start_date_raw = clean_str(request.args.get("start_date"))
    end_date_raw = clean_str(request.args.get("end_date"))
    granularity = clean_str(request.args.get("granularity")).lower() or "day"
    if granularity not in {"day", "week", "month"}:
        granularity = "day"
    try:
        top_n = int(request.args.get("top_n") or 5)
    except Exception:
        top_n = 5
    top_n = max(1, min(top_n, 10))

    def parse_ymd(raw):
        if not raw:
            return None
        try:
            return datetime.strptime(raw, "%Y-%m-%d")
        except Exception:
            return None

    start_dt = parse_ymd(start_date_raw)
    end_dt_inclusive = parse_ymd(end_date_raw)
    end_dt = end_dt_inclusive + timedelta(days=1) if end_dt_inclusive else None

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

    rec_rows = db.execute(
        "SELECT user_id, variant_key, answers_json, served_at FROM recommendation_impressions"
    ).fetchall()
    car_rows = db.execute(
        "SELECT user_id, variant_key, answers_json, served_at FROM car_impressions"
    ).fetchall()

    impressions_map = {}
    for r in list(rec_rows) + list(car_rows):
        key = (r["user_id"], r["variant_key"])
        served = parse_iso(r["served_at"])
        if not served:
            continue
        existing = impressions_map.get(key)
        if not existing or served < existing["served_at"]:
            impressions_map[key] = {
                "user_id": r["user_id"],
                "variant_key": r["variant_key"],
                "answers_json": r["answers_json"] or existing.get("answers_json") if existing else r["answers_json"],
                "served_at": served,
            }

    seg = {}
    for item in impressions_map.values():
        answers = json.loads(item["answers_json"] or "{}")
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
        imp = impressions_map.get((s["user_id"], s["variant_key"]))
        if not imp:
            continue
        if created >= imp["served_at"]:
            answers = json.loads(imp["answers_json"] or "{}")
            fuel_seg = clean_str(answers.get("fuelType")) or "Unknown"
            budget_seg = clean_str(answers.get("budget")) or "Unknown"
            k = f"{fuel_seg} | {budget_seg}"
            if k in seg:
                seg[k]["saves"] += 1

    conv = []
    for item in seg.values():
        imp = item["impressions"]
        sv = item["saves"]
        item["conversion_rate"] = round((sv / imp) * 100, 2) if imp else 0.0
        conv.append(item)

    conv.sort(key=lambda x: x["conversion_rate"], reverse=True)

    def in_selected_range(ts):
        if not ts:
            return False
        if start_dt and ts < start_dt:
            return False
        if end_dt and ts >= end_dt:
            return False
        return True

    filtered_saves = []
    save_counts_by_variant = {}
    for s in saves:
        ts = parse_iso(s["created_at"])
        if not in_selected_range(ts):
            continue
        vk = clean_str(s["variant_key"])
        if not vk:
            continue
        filtered_saves.append((ts, vk))
        save_counts_by_variant[vk] = save_counts_by_variant.get(vk, 0) + 1

    top_saved_pairs = sorted(save_counts_by_variant.items(), key=lambda x: (-x[1], x[0]))[:10]
    top_saves = [{"variant_key": vk, "cnt": cnt} for vk, cnt in top_saved_pairs]

    top_series_variants = [vk for vk, _ in sorted(save_counts_by_variant.items(), key=lambda x: (-x[1], x[0]))[:top_n]]

    bookings_rows = db.execute("SELECT variant_key, model, created_at FROM bookings").fetchall()
    filtered_bookings = []
    booking_counts_by_variant = {}
    for b in bookings_rows:
        ts = parse_iso(b["created_at"])
        if not in_selected_range(ts):
            continue
        vk = clean_str(b["variant_key"]) or clean_str(b["model"]) or "Unknown"
        filtered_bookings.append((ts, vk))
        booking_counts_by_variant[vk] = booking_counts_by_variant.get(vk, 0) + 1

    top_booking_pairs = sorted(booking_counts_by_variant.items(), key=lambda x: (-x[1], x[0]))[:10]
    top_bookings = [{"variant_key": vk, "cnt": cnt} for vk, cnt in top_booking_pairs]
    top_booking_series_variants = [vk for vk, _ in sorted(booking_counts_by_variant.items(), key=lambda x: (-x[1], x[0]))[:top_n]]

    def bucket_key(ts):
        if granularity == "week":
            week_start = (ts - timedelta(days=ts.weekday())).date()
            return week_start.isoformat()
        if granularity == "month":
            return f"{ts.year:04d}-{ts.month:02d}-01"
        return ts.date().isoformat()

    bucket_counts = {}
    for ts, vk in filtered_saves:
        bk = bucket_key(ts)
        if bk not in bucket_counts:
            bucket_counts[bk] = {}
        bucket_counts[bk][vk] = bucket_counts[bk].get(vk, 0) + 1

    def month_start(dt):
        return datetime(dt.year, dt.month, 1)

    def next_month(dt):
        if dt.month == 12:
            return datetime(dt.year + 1, 1, 1)
        return datetime(dt.year, dt.month + 1, 1)

    selected_buckets = sorted(bucket_counts.keys())
    if start_dt and end_dt:
        if granularity == "month":
            cursor = month_start(start_dt)
            limit = end_dt
            selected_buckets = []
            while cursor < limit:
                selected_buckets.append(cursor.date().isoformat())
                cursor = next_month(cursor)
        elif granularity == "week":
            cursor = start_dt - timedelta(days=start_dt.weekday())
            limit = end_dt
            selected_buckets = []
            while cursor < limit:
                selected_buckets.append(cursor.date().isoformat())
                cursor = cursor + timedelta(days=7)
        else:
            cursor = start_dt
            limit = end_dt
            selected_buckets = []
            while cursor < limit:
                selected_buckets.append(cursor.date().isoformat())
                cursor = cursor + timedelta(days=1)

    series = []
    for vk in top_series_variants:
        series.append(
            {
                "variant_key": vk,
                "counts": [int(bucket_counts.get(bk, {}).get(vk, 0)) for bk in selected_buckets],
            }
        )

    booked_bucket_counts = {}
    for ts, vk in filtered_bookings:
        bk = bucket_key(ts)
        if bk not in booked_bucket_counts:
            booked_bucket_counts[bk] = {}
        booked_bucket_counts[bk][vk] = booked_bucket_counts[bk].get(vk, 0) + 1

    booked_selected_buckets = selected_buckets if selected_buckets else sorted(booked_bucket_counts.keys())
    booked_series = []
    for vk in top_booking_series_variants:
        booked_series.append(
            {
                "variant_key": vk,
                "counts": [int(booked_bucket_counts.get(bk, {}).get(vk, 0)) for bk in booked_selected_buckets],
            }
        )

    imp_counts = {}
    save_counts = {}

    imp_rows = db.execute("SELECT served_at FROM recommendation_impressions").fetchall()
    imp_rows += db.execute("SELECT served_at FROM car_impressions").fetchall()
    for r in imp_rows:
        ts = parse_iso(r["served_at"])
        if not ts:
            continue
        d = ts.date().isoformat()
        imp_counts[d] = imp_counts.get(d, 0) + 1

    save_rows = db.execute("SELECT created_at FROM user_feedback WHERE event_type = 'save'").fetchall()
    for r in save_rows:
        ts = parse_iso(r["created_at"])
        if not ts:
            continue
        d = ts.date().isoformat()
        save_counts[d] = save_counts.get(d, 0) + 1

    all_dates = sorted(set(imp_counts.keys()) | set(save_counts.keys()))
    if len(all_dates) > 14:
        all_dates = all_dates[-14:]

    trend = [
        {
            "date": d,
            "impressions": imp_counts.get(d, 0),
            "saves": save_counts.get(d, 0),
        }
        for d in all_dates
    ]

    return jsonify(
        {
            "top_clicked_variants": [dict(r) for r in top_clicks],
            "top_saved_variants": top_saves,
            "top_booked_variants": top_bookings,
            "conversion_by_quiz_segment": conv[:20],
            "impressions_saves_trend": trend,
            "saved_variants_timeseries": {
                "granularity": granularity,
                "buckets": selected_buckets,
                "series": series,
            },
            "booked_cars_timeseries": {
                "granularity": granularity,
                "buckets": booked_selected_buckets,
                "series": booked_series,
            },
            "filters": {
                "start_date": start_date_raw or None,
                "end_date": end_date_raw or None,
                "top_n": top_n,
                "granularity": granularity,
            },
        }
    )


@app.get("/admin/bookings")
@admin_required
def admin_bookings():
    rows = get_db().execute(
        """
        SELECT id, booking_reference, user_id, user_name, user_email, user_phone, showroom_id, showroom_name, showroom_address,
               province, model, variant, variant_key, notes, status, created_at
        FROM bookings
        ORDER BY created_at DESC
        LIMIT 300
        """
    ).fetchall()
    return jsonify({"bookings": [dict(r) for r in rows]})


@app.patch("/admin/bookings/<int:booking_id>")
@admin_required
def update_booking_status(booking_id):
    payload = request.get_json(silent=True) or {}
    status = clean_str(payload.get("status")) or "pending"
    allowed = {"pending", "accepted", "rejected"}
    if status not in allowed:
        return jsonify({"error": "Invalid status."}), 400

    db = get_db()
    existing = db.execute(
        """
        SELECT id, booking_reference, user_id, user_name, user_email, user_phone, showroom_id, showroom_name, showroom_address,
               province, model, variant, variant_key, notes, status, created_at
        FROM bookings
        WHERE id = ?
        """,
        (booking_id,),
    ).fetchone()
    if not existing:
        return jsonify({"error": "Booking not found."}), 404

    old_status = clean_str(existing["status"]).lower()
    db.execute("UPDATE bookings SET status = ? WHERE id = ?", (status, booking_id))
    db.commit()

    row = db.execute(
        """
        SELECT id, booking_reference, user_id, user_name, user_email, user_phone, showroom_id, showroom_name, showroom_address,
               province, model, variant, variant_key, notes, status, created_at
        FROM bookings
        WHERE id = ?
        """,
        (booking_id,),
    ).fetchone()
    if not row:
        return jsonify({"error": "Booking not found."}), 404

    email_delivery = None
    if status == "accepted" and old_status != "accepted":
        email_delivery = send_booking_accepted_email(dict(row))

    response = {"message": "Booking updated.", "booking": dict(row)}
    if email_delivery is not None:
        response["booking_confirmation_email"] = email_delivery
        if not email_delivery.get("sent"):
            response["message"] = "Booking updated, but confirmation email was not sent."
    return jsonify(response)


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
