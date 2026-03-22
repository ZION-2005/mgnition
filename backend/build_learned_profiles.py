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


# Map Q11 factor importance into quiz section importance.
SECTION_FACTOR_MAP = {
    "occupation": {"Price": 0.45, "Fuel & Efficiency": 0.25, "Performance": 0.20, "Space & Practicality": 0.10},
    "hobbies": {"Design": 0.35, "Performance": 0.30, "Space & Practicality": 0.25, "Fuel & Efficiency": 0.10},
    "usage": {"Space & Practicality": 0.45, "Fuel & Efficiency": 0.45, "Price": 0.10},
    "daily_distance": {"Fuel & Efficiency": 0.80, "Space & Practicality": 0.20},
}


def clean_str(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def normalize_text(v: Any) -> str:
    return clean_str(v).lower().replace("  ", " ").strip()


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


def find_col(columns, fragments):
    cols = list(columns)
    lower_cols = {c: normalize_text(c) for c in cols}
    for frag in fragments:
        frag_n = normalize_text(frag)
        for c in cols:
            if frag_n in lower_cols[c]:
                return c
    return None


def parse_rank(value: Any) -> Optional[int]:
    s = normalize_text(value)
    if not s:
        return None
    for ch in s:
        if ch.isdigit():
            rank = int(ch)
            if 1 <= rank <= 5:
                return rank
            return None
    return None


def compute_section_weights_from_q11(df: pd.DataFrame) -> Dict[str, Any]:
    cols = df.columns
    factor_cols = {
        "Price": find_col(cols, ["[price]"]),
        "Fuel & Efficiency": find_col(cols, ["[fuel & efficiency]"]),
        "Space & Practicality": find_col(cols, ["[space & practicality]"]),
        "Performance": find_col(cols, ["[performance]"]),
        "Design": find_col(cols, ["[design]"]),
    }
    if any(v is None for v in factor_cols.values()):
        return {}

    factor_scores: Dict[str, float] = {}
    rank_counts: Dict[str, int] = {}
    for factor_name, col in factor_cols.items():
        points: List[float] = []
        for value in df[col]:
            rank = parse_rank(value)
            if rank is None:
                continue
            points.append(float(6 - rank))  # rank-1 gets 5 points, rank-5 gets 1 point
        if not points:
            continue
        factor_scores[factor_name] = float(sum(points) / len(points))
        rank_counts[factor_name] = len(points)

    if not factor_scores:
        return {}

    factor_total = float(sum(factor_scores.values()))
    if factor_total <= 0:
        return {}
    factor_weights = {k: float(v) / factor_total for k, v in factor_scores.items()}

    section_raw: Dict[str, float] = {}
    for section, mapping in SECTION_FACTOR_MAP.items():
        score = 0.0
        for factor_name, multiplier in mapping.items():
            score += float(multiplier) * float(factor_weights.get(factor_name, 0.0))
        section_raw[section] = score

    section_total = float(sum(section_raw.values()))
    if section_total <= 0:
        return {}

    section_weights = {k: float(v) / section_total for k, v in section_raw.items()}
    return {
        "section_weights": section_weights,
        "factor_weights": factor_weights,
        "rank_counts": rank_counts,
    }


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


def _variant_year_num(v: Mapping[str, Any]) -> float:
    try:
        return float(v.get("year") or 0)
    except Exception:
        return 0.0


def _pick_variant(cands: List[Mapping[str, Any]], preferred_variant_token: Optional[str] = None):
    if not cands:
        return None
    selected = cands
    if preferred_variant_token:
        pv = normalize_text(preferred_variant_token)
        filtered = [x for x in cands if pv in normalize_text(x.get("variant"))]
        if filtered:
            selected = filtered
    selected = sorted(selected, key=lambda x: (float(x.get("price_thb") or 0), -_variant_year_num(x)))
    return selected[0]


def survey_choice_to_variant_map(variants: List[Mapping[str, Any]]) -> Dict[str, str]:
    by_label: Dict[str, List[Mapping[str, Any]]] = {
        "mg3_hybrid": [],
        "mgs5_ev_plus": [],
        "mg_vs_hev": [],
        "mg_es": [],
        "mg_hs": [],
    }

    for v in variants:
        model = normalize_text(v.get("model"))
        fuel_type = normalize_text(v.get("fuel_type"))
        if "mg 3 hybrid" in model:
            by_label["mg3_hybrid"].append(v)
        elif "mgs5 ev plus" in model or "mg s5 ev plus" in model:
            by_label["mgs5_ev_plus"].append(v)
        elif "mg vs hev" in model:
            by_label["mg_vs_hev"].append(v)
        elif model.startswith("mg es"):
            by_label["mg_es"].append(v)
        elif model.startswith("mg hs") and "phev" not in fuel_type:
            by_label["mg_hs"].append(v)

    chosen = {
        "mg3_hybrid": _pick_variant(by_label["mg3_hybrid"], "d"),
        "mgs5_ev_plus": _pick_variant(by_label["mgs5_ev_plus"], "d+"),
        "mg_vs_hev": _pick_variant(by_label["mg_vs_hev"], "x"),
        "mg_es": _pick_variant(by_label["mg_es"]),
        "mg_hs": _pick_variant(by_label["mg_hs"], "d"),
    }
    return {k: clean_str(v.get("variant_key")) for k, v in chosen.items() if v}


def normalize_usage_label(value: str) -> str:
    v = normalize_text(value).replace(" / ", "/").replace("/ ", "/").replace(" /", "/")
    mapping = {
        "city commuting": "City commuting",
        "cargo & practical use": "Cargo & Practical use",
        "cargo and practical use": "Cargo & Practical use",
        "highway/long-distance": "Highway/Long-distance",
        "eco-conscious lifestyle": "Eco-conscious lifestyle",
    }
    return mapping.get(v, clean_str(value))


def load_survey_interactions(csv_path: Path, variants: List[Mapping[str, Any]]) -> List[Tuple[Dict[str, Any], str]]:
    if not csv_path.exists():
        return []
    df = pd.read_csv(csv_path)
    cols = df.columns
    colmap = {
        "occupation": find_col(cols, ["occupation"]),
        "hobbies": find_col(cols, ["hobbies"]),
        "usage": find_col(cols, ["use your car most"]),
        "distance": find_col(cols, ["how far do you drive each day"]),
        "budget": find_col(cols, ["how much would you spend"]),
        "seats": find_col(cols, ["how many seats"]),
        "fuel": find_col(cols, ["which type of fuel"]),
        "choice": find_col(cols, ["if you were to purchase a car today"]),
    }
    missing = [k for k, v in colmap.items() if v is None]
    if missing:
        raise ValueError(f"Missing required survey columns: {', '.join(missing)}")

    choice_map = survey_choice_to_variant_map(variants)
    out: List[Tuple[Dict[str, Any], str]] = []
    for _, row in df.iterrows():
        choice_label = canonical_survey_choice_label(row.get(colmap["choice"]))
        variant_key = choice_map.get(choice_label)
        if not variant_key:
            continue

        usage = normalize_usage_label(clean_str(row.get(colmap["usage"])))
        hobbies = [normalize_hobby(h) for h in as_list(row.get(colmap["hobbies"]))]
        distance = clean_str(row.get(colmap["distance"]))
        answers = {
            "occupation": clean_str(row.get(colmap["occupation"])) or "Others",
            "hobbies": hobbies,
            "usage": [usage] if usage else [],
            "daily_distance": distance,
            "distance": distance,
            "budget_choice": clean_str(row.get(colmap["budget"])),
            "seat_choice": clean_str(row.get(colmap["seats"])),
            "fuelType": clean_str(row.get(colmap["fuel"])),
        }
        out.append((answers, variant_key))
    return out


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
    parser = argparse.ArgumentParser(description="Build learned quiz profiles from feedback data and/or survey CSV.")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="Path to mgnition.db")
    parser.add_argument("--variants", default=str(DEFAULT_VARIANT_PATH), help="Path to modelVariants.json")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_PATH), help="Output JSON path")
    parser.add_argument("--survey-csv", default="", help="Path to cleaned survey CSV (optional).")
    parser.add_argument(
        "--source",
        default="feedback",
        choices=["feedback", "survey", "both"],
        help="Input source for profile learning.",
    )
    args = parser.parse_args()

    db_path = Path(args.db)
    variant_path = Path(args.variants)
    output_path = Path(args.output)
    survey_csv = Path(args.survey_csv).expanduser().resolve() if clean_str(args.survey_csv) else None

    variants = load_variants(variant_path, db_path)
    car_df = pd.DataFrame(variants)
    interactions: List[Tuple[Dict[str, Any], str]] = []
    feedback_count = 0
    survey_count = 0
    q11_info: Dict[str, Any] = {}

    if args.source in ("feedback", "both"):
        feedback_interactions = load_positive_interactions(db_path)
        feedback_count = len(feedback_interactions)
        interactions.extend(feedback_interactions)

    if args.source in ("survey", "both"):
        if not survey_csv:
            raise ValueError("--survey-csv is required when --source is 'survey' or 'both'.")
        survey_interactions = load_survey_interactions(survey_csv, variants)
        survey_count = len(survey_interactions)
        interactions.extend(survey_interactions)

        try:
            survey_df = pd.read_csv(survey_csv)
            q11_info = compute_section_weights_from_q11(survey_df)
        except Exception:
            q11_info = {}

    profiles = build_profiles(car_df, interactions)
    profiles["meta"]["source_mode"] = args.source
    profiles["meta"]["feedback_interactions"] = feedback_count
    profiles["meta"]["survey_interactions"] = survey_count
    if args.source in ("survey", "both"):
        if q11_info.get("section_weights"):
            profiles["meta"]["section_weights"] = q11_info["section_weights"]
            profiles["meta"]["q11_factor_weights"] = q11_info.get("factor_weights", {})
            profiles["meta"]["q11_rank_counts"] = q11_info.get("rank_counts", {})

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(profiles, indent=2))

    print(f"Saved learned profiles to {output_path}")
    print(f"Total interactions: {len(interactions)}")
    print(f"- feedback interactions: {feedback_count}")
    print(f"- survey interactions: {survey_count}")
    if args.source in ("survey", "both") and q11_info.get("section_weights"):
        print(f"- q11 section weights: {q11_info['section_weights']}")
    for section in ("occupation", "hobbies", "usage", "daily_distance"):
        print(f"{section}: {len(profiles.get(section, {}))} labels")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
