#!/usr/bin/env python3
"""
Sync frontend catalog JSON data into PostgreSQL.

Creates/updates:
- catalog_models
- catalog_variants
- showrooms

Usage:
  DATABASE_URL="postgresql://USER@localhost:5433/mgnition" \
  backend/.venv/bin/python scripts/sync_catalog_to_db.py
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, Optional, Tuple

try:
    import psycopg2
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "psycopg2 is required. Run with backend/.venv/bin/python or install dependencies first."
    ) from exc


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "mgnition-frontend" / "src" / "data"
MODELS_PATH = DATA_DIR / "models.json"
VARIANTS_PATH = DATA_DIR / "modelVariants.json"
SHOWROOMS_PATH = DATA_DIR / "showrooms.json"


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return re.sub(r"\s+", " ", text)


def to_int(value: Any) -> Optional[int]:
    if value in (None, "", "-"):
        return None
    try:
        return int(float(str(value).replace(",", "").strip()))
    except Exception:
        return None


def to_float(value: Any) -> Optional[float]:
    if value in (None, "", "-"):
        return None
    try:
        return float(str(value).replace(",", "").strip())
    except Exception:
        return None


def variant_key(model: Any, variant: Any, year: Any) -> str:
    return f"{clean_text(model)}|{clean_text(variant)}|{clean_text(year)}"


def parse_province_postal(address: str) -> Tuple[str, str]:
    addr = clean_text(address)
    postal_match = re.search(r"(\d{5})\s*$", addr)
    postal = postal_match.group(1) if postal_match else ""

    if "," in addr:
        parts = [p.strip() for p in addr.split(",") if p.strip()]
        if len(parts) >= 2:
            maybe = re.sub(r"\s+\d{5}\s*$", "", parts[-1]).strip()
            return maybe, postal
    return "", postal


def load_json(path: Path) -> Iterable[Dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))


def create_tables(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS catalog_models (
            model_name TEXT PRIMARY KEY,
            price_text TEXT,
            fuel_type TEXT,
            seats INTEGER,
            body_type TEXT,
            default_color TEXT,
            color_images_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS catalog_variants (
            variant_key TEXT PRIMARY KEY,
            model_name TEXT NOT NULL,
            variant_name TEXT,
            year INTEGER,
            price_thb INTEGER,
            fuel_type TEXT,
            seats INTEGER,
            body_type TEXT,
            horsepower_hp INTEGER,
            torque_nm INTEGER,
            cargo_liters INTEGER,
            length_mm INTEGER,
            width_mm INTEGER,
            height_mm INTEGER,
            wheelbase_mm INTEGER,
            range_km INTEGER,
            fuel_consumption_kml TEXT,
            available_colors TEXT,
            image_url TEXT,
            color_images_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS showrooms (
            showroom_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT,
            province TEXT,
            postal_code TEXT,
            lat DOUBLE PRECISION,
            lng DOUBLE PRECISION,
            phone TEXT,
            raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_catalog_variants_model ON catalog_variants(model_name);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_showrooms_province ON showrooms(province);")


def upsert_models(cur, rows: Iterable[Dict[str, Any]]) -> int:
    count = 0
    for row in rows:
        model_name = clean_text(row.get("model"))
        if not model_name:
            continue
        cur.execute(
            """
            INSERT INTO catalog_models
            (model_name, price_text, fuel_type, seats, body_type, default_color, color_images_json, raw_json, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, NOW())
            ON CONFLICT (model_name) DO UPDATE SET
                price_text = EXCLUDED.price_text,
                fuel_type = EXCLUDED.fuel_type,
                seats = EXCLUDED.seats,
                body_type = EXCLUDED.body_type,
                default_color = EXCLUDED.default_color,
                color_images_json = EXCLUDED.color_images_json,
                raw_json = EXCLUDED.raw_json,
                updated_at = NOW();
            """,
            (
                model_name,
                clean_text(row.get("price")),
                clean_text(row.get("fuel")),
                to_int(row.get("seats")),
                clean_text(row.get("bodyType")),
                clean_text(row.get("defaultColor")),
                json.dumps(row.get("colorImages") or {}, ensure_ascii=False),
                json.dumps(row, ensure_ascii=False),
            ),
        )
        count += 1
    return count


def upsert_variants(cur, rows: Iterable[Dict[str, Any]]) -> int:
    count = 0
    for row in rows:
        model_name = clean_text(row.get("Model"))
        v_key = variant_key(row.get("Model"), row.get("Variant"), row.get("Year"))
        if not model_name:
            continue
        cur.execute(
            """
            INSERT INTO catalog_variants
            (variant_key, model_name, variant_name, year, price_thb, fuel_type, seats, body_type,
             horsepower_hp, torque_nm, cargo_liters, length_mm, width_mm, height_mm, wheelbase_mm,
             range_km, fuel_consumption_kml, available_colors, image_url, color_images_json, raw_json, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, NOW())
            ON CONFLICT (variant_key) DO UPDATE SET
                model_name = EXCLUDED.model_name,
                variant_name = EXCLUDED.variant_name,
                year = EXCLUDED.year,
                price_thb = EXCLUDED.price_thb,
                fuel_type = EXCLUDED.fuel_type,
                seats = EXCLUDED.seats,
                body_type = EXCLUDED.body_type,
                horsepower_hp = EXCLUDED.horsepower_hp,
                torque_nm = EXCLUDED.torque_nm,
                cargo_liters = EXCLUDED.cargo_liters,
                length_mm = EXCLUDED.length_mm,
                width_mm = EXCLUDED.width_mm,
                height_mm = EXCLUDED.height_mm,
                wheelbase_mm = EXCLUDED.wheelbase_mm,
                range_km = EXCLUDED.range_km,
                fuel_consumption_kml = EXCLUDED.fuel_consumption_kml,
                available_colors = EXCLUDED.available_colors,
                image_url = EXCLUDED.image_url,
                color_images_json = EXCLUDED.color_images_json,
                raw_json = EXCLUDED.raw_json,
                updated_at = NOW();
            """,
            (
                v_key,
                model_name,
                clean_text(row.get("Variant")),
                to_int(row.get("Year")),
                to_int(row.get("Price_THB")),
                clean_text(row.get("Fuel_Type")),
                to_int(row.get("Seats")),
                clean_text(row.get("Body_Type")),
                to_int(row.get("Horsepower_hp")),
                to_int(row.get("Torque_Nm")),
                to_int(row.get("Cargo_Liters")),
                to_int(row.get("Length_mm")),
                to_int(row.get("Width_mm")),
                to_int(row.get("Height_mm")),
                to_int(row.get("Wheelbase_mm")),
                to_int(row.get("Range_km")),
                clean_text(row.get("Fuel_Consumption_kmL")),
                clean_text(row.get("Available_Colors")),
                clean_text(row.get("Image_URL")),
                json.dumps(row.get("Color_Images") or {}, ensure_ascii=False),
                json.dumps(row, ensure_ascii=False),
            ),
        )
        count += 1
    return count


def upsert_showrooms(cur, rows: Iterable[Dict[str, Any]]) -> int:
    count = 0
    for row in rows:
        showroom_id = clean_text(row.get("id"))
        if not showroom_id:
            continue
        address = clean_text(row.get("address"))
        province, postal_code = parse_province_postal(address)
        cur.execute(
            """
            INSERT INTO showrooms
            (showroom_id, name, address, province, postal_code, lat, lng, phone, raw_json, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
            ON CONFLICT (showroom_id) DO UPDATE SET
                name = EXCLUDED.name,
                address = EXCLUDED.address,
                province = EXCLUDED.province,
                postal_code = EXCLUDED.postal_code,
                lat = EXCLUDED.lat,
                lng = EXCLUDED.lng,
                phone = EXCLUDED.phone,
                raw_json = EXCLUDED.raw_json,
                updated_at = NOW();
            """,
            (
                showroom_id,
                clean_text(row.get("name")),
                address,
                province,
                postal_code,
                to_float(row.get("lat")),
                to_float(row.get("lng")),
                clean_text(row.get("phone")),
                json.dumps(row, ensure_ascii=False),
            ),
        )
        count += 1
    return count


def default_database_url() -> str:
    user = os.getenv("PGUSER") or os.getenv("USER") or ""
    host = os.getenv("PGHOST", "localhost")
    port = os.getenv("PGPORT", "5433")
    db = os.getenv("PGDATABASE", "mgnition")
    return f"postgresql://{user}@{host}:{port}/{db}"


def main() -> None:
    database_url = (os.getenv("DATABASE_URL") or "").strip() or default_database_url()
    models = list(load_json(MODELS_PATH))
    variants = list(load_json(VARIANTS_PATH))
    showrooms = list(load_json(SHOWROOMS_PATH))

    conn = psycopg2.connect(database_url)
    try:
        with conn:
            with conn.cursor() as cur:
                create_tables(cur)
                model_count = upsert_models(cur, models)
                variant_count = upsert_variants(cur, variants)
                showroom_count = upsert_showrooms(cur, showrooms)

        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM catalog_models")
            total_models = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM catalog_variants")
            total_variants = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM showrooms")
            total_showrooms = int(cur.fetchone()[0])
    finally:
        conn.close()

    print(f"Synced models rows: {model_count} (db total: {total_models})")
    print(f"Synced variants rows: {variant_count} (db total: {total_variants})")
    print(f"Synced showrooms rows: {showroom_count} (db total: {total_showrooms})")


if __name__ == "__main__":
    main()
