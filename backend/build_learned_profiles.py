from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

import pandas as pd

from cosine_recommender import prepare_car_vectors


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = ROOT_DIR / "backend" / "mgnition.db"
DEFAULT_VARIANT_PATH = ROOT_DIR / "mgnition-frontend" / "src" / "data" / "modelVariants.json"
DEFAULT_OUTPUT_PATH = ROOT_DIR / "backend" / "data" / "learned_profiles.json"


def clean_str(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def variant_key_from_values(model: Any, variant: Any, year: Any) -> str:
    return f"{clean_str(model)}|{clean_str(variant)}|{clean_str(year)}"


def parse_iso(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", ""))
    except Exception:
        return None


HOBBY_ALIASES = {
    "travel": "Adventure & Travel",
    "adventure": "Adventure & Travel",
    "city life": "City Life & Socializing",
    "socializing": "City Life & Socializing",
    "minimalist": "Relaxed & Minimalist Lifestyle",
    "relaxed": "Relaxed & Minimalist Lifestyle",
    "outdoor": "Outdoor Sports & Fitness",
    "fitness": "Outdoor Sports & Fitness",
}


def normalize_hobby(label: str) -> str:
    raw = clean_str(label)
    if not raw:
        return raw
    key = raw.lower()
    for k, v in HOBBY_ALIASES.items():
        if k in key:
            return v
    return raw


def load_variants(variant_path: Path, db_path: Path) -> List[Dict[str, Any]]:
    variants: List[Dict[str, Any]] = []
    if variant_path.exists():
        raw = json.loads(variant_path.read_text())
        for r in raw:
            if not r.get("Model"):
                continue
            variants.append(
                {
                    "variant_key": variant_key_from_values(r.get("Model"), r.get("Variant"), r.get("Year")),
                    "model": clean_str(r.get("Model")),
                    "variant": clean_str(r.get("Variant")),
                    "year": clean_str(r.get("Year")),
                    "price_thb": float(r.get("Price_THB") or 0),
                    "fuel_type": clean_str(r.get("Fuel_Type")),
                    "seats": float(r.get("Seats") or 0),
                    "body_type": clean_str(r.get("Body_Type")),
                    "horsepower_hp": float(r.get("Horsepower_hp") or 0),
                    "torque_nm": float(r.get("Torque_Nm") or 0),
                    "range_km": float(r.get("Range_km") or 0),
                    "cargo_liters": float(r.get("Cargo_Liters") or 0),
                    "fuel_consumption_kml": r.get("Fuel_Consumption_kmL"),
                }
            )

    if db_path.exists():
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, model, variant, year, price_thb, fuel_type, seats, body_type,
                   horsepower_hp, torque_nm, range_km, cargo_liters
            FROM admin_models
            WHERE active = 1
            """
        ).fetchall()
        for r in rows:
            variants.append(
                {
                    "variant_key": f"ADMIN|{r['id']}",
                    "model": clean_str(r["model"]),
                    "variant": clean_str(r["variant"]),
                    "year": clean_str(r["year"]),
                    "price_thb": float(r["price_thb"] or 0),
                    "fuel_type": clean_str(r["fuel_type"]),
                    "seats": float(r["seats"] or 0),
                    "body_type": clean_str(r["body_type"]),
                    "horsepower_hp": float(r["horsepower_hp"] or 0),
                    "torque_nm": float(r["torque_nm"] or 0),
                    "range_km": float(r["range_km"] or 0),
                    "cargo_liters": float(r["cargo_liters"] or 0),
                    "fuel_consumption_kml": None,
                }
            )
        conn.close()

    return variants


def as_list(v: Any) -> List[str]:
    if isinstance(v, list):
        return [clean_str(x) for x in v if clean_str(x)]
    if isinstance(v, str):
        return [x.strip() for x in v.split(",") if x.strip()]
    c = clean_str(v)
    return [c] if c else []


def load_positive_interactions(db_path: Path) -> List[Tuple[Dict[str, Any], str]]:
    if not db_path.exists():
        return []
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT i.user_id, i.variant_key, i.answers_json, i.served_at,
               f.event_type, f.created_at
        FROM recommendation_impressions i
        JOIN user_feedback f
          ON f.user_id = i.user_id AND f.variant_key = i.variant_key
        WHERE f.event_type IN ('save','booking')
        """
    ).fetchall()
    conn.close()

    out: List[Tuple[Dict[str, Any], str]] = []
    for r in rows:
        served = parse_iso(r["served_at"])
        created = parse_iso(r["created_at"])
        if served and created and created < served:
            continue
        try:
            answers = json.loads(r["answers_json"] or "{}")
        except Exception:
            answers = {}
        out.append((answers, r["variant_key"]))
    return out


def build_profiles(
    car_df: pd.DataFrame,
    interactions: List[Tuple[Dict[str, Any], str]],
) -> Dict[str, Any]:
    if car_df.empty or not interactions:
        return {
            "meta": {"alpha": 0.7, "min_samples": 3},
            "global_profile": {},
            "occupation": {},
            "hobbies": {},
            "usage": {},
            "daily_distance": {},
        }

    car_df = prepare_car_vectors(car_df)
    car_lookup = {
        r["variant_key"]: r
        for r in car_df.to_dict(orient="records")
        if clean_str(r.get("variant_key"))
    }

    sections = {
        "occupation": ["price_weight", "hp_weight", "ev_weight", "seats_weight"],
        "hobbies": ["cargo_weight", "suv_pref", "range_weight", "torque_weight"],
        "usage": ["suv_pref", "sedan_pref", "efficiency_weight", "cargo_weight", "range_weight"],
        "daily_distance": ["ev_weight", "hev_weight", "ice_weight", "range_priority"],
    }

    def car_value(row: Mapping[str, Any], key: str) -> float:
        if key == "ev_weight":
            return float(row.get("fuel_ev_weight", 0))
        if key == "hev_weight":
            return float(row.get("fuel_hev_weight", 0))
        if key == "ice_weight":
            return float(row.get("fuel_ice_weight", 0))
        if key == "range_priority":
            return float(row.get("range_weight", 0))
        return float(row.get(key, 0))

    buckets: Dict[str, Dict[str, Dict[str, Any]]] = {
        "occupation": {},
        "hobbies": {},
        "usage": {},
        "daily_distance": {},
    }

    global_sum = {k: 0.0 for k in ["price_weight", "hp_weight", "seats_weight", "range_weight", "cargo_weight", "torque_weight", "suv_pref", "sedan_pref", "fuel_ev_weight", "fuel_hev_weight", "fuel_ice_weight", "efficiency_weight"]}
    global_count = 0

    for answers, variant_key in interactions:
        row = car_lookup.get(variant_key)
        if not row:
            continue

        global_count += 1
        for k in global_sum:
            global_sum[k] += float(row.get(k, 0))

        occupation = clean_str(answers.get("occupation") or "Others")
        hobbies = [normalize_hobby(h) for h in as_list(answers.get("hobbies"))]
        usage = as_list(answers.get("usage"))
        daily_distance = clean_str(answers.get("daily_distance") or answers.get("distance") or "")

        for section, keys in sections.items():
            if section == "occupation":
                labels = [occupation] if occupation else []
            elif section == "hobbies":
                labels = hobbies
            elif section == "usage":
                labels = usage
            else:
                labels = [daily_distance] if daily_distance else []

            for label in labels:
                if not label:
                    continue
                bucket = buckets[section].setdefault(label, {"count": 0, "sum": {k: 0.0 for k in keys}})
                bucket["count"] += 1
                for k in keys:
                    bucket["sum"][k] += car_value(row, k)

    profiles: Dict[str, Any] = {
        "meta": {"alpha": 0.7, "min_samples": 3, "built_at": datetime.utcnow().isoformat(timespec="seconds") + "Z"},
        "global_profile": {},
        "occupation": {},
        "hobbies": {},
        "usage": {},
        "daily_distance": {},
    }

    if global_count:
        profiles["global_profile"] = {k: v / global_count for k, v in global_sum.items()}

    for section, labels in buckets.items():
        for label, payload in labels.items():
            cnt = payload.get("count", 0)
            sums = payload.get("sum", {})
            if not cnt:
                continue
            profiles[section][label] = {
                "count": cnt,
                "profile": {k: float(sums.get(k, 0.0)) / cnt for k in sums},
            }

    return profiles


def main() -> int:
    parser = argparse.ArgumentParser(description="Build learned quiz profiles from feedback data.")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="Path to mgnition.db")
    parser.add_argument("--variants", default=str(DEFAULT_VARIANT_PATH), help="Path to modelVariants.json")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_PATH), help="Output JSON path")
    args = parser.parse_args()

    db_path = Path(args.db)
    variant_path = Path(args.variants)
    output_path = Path(args.output)

    variants = load_variants(variant_path, db_path)
    car_df = pd.DataFrame(variants)
    interactions = load_positive_interactions(db_path)
    profiles = build_profiles(car_df, interactions)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(profiles, indent=2))

    print(f"Saved learned profiles to {output_path}")
    print(f"Positive interactions: {len(interactions)}")
    for section in ("occupation", "hobbies", "usage", "daily_distance"):
        print(f"{section}: {len(profiles.get(section, {}))} labels")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
