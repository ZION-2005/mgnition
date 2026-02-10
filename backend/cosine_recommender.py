from __future__ import annotations

from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import numpy as np
import pandas as pd
from sklearn.metrics.pairwise import cosine_similarity


# -----------------------------
# Mapping dictionaries
# -----------------------------

BUDGET_MAP: Dict[str, Optional[float]] = {
    "Below 700,000 THB": 700_000,
    "700,000 - 999,999 THB": 999_999,
    "1,000,000 - 1,299,999 THB": 1_299_999,
    "1,300,000 THB and above": None,
}

SEATS_MAP: Dict[str, Dict[str, Optional[int]]] = {
    "2 seats": {"min_seats": 2, "max_seats": 2},
    "3-5 seats": {"min_seats": 3, "max_seats": 5},
    "5+ seats": {"min_seats": 5, "max_seats": None},
}

OCCUPATION_MAP: Dict[str, Dict[str, float]] = {
    "Student": {
        "price_weight": 0.90,
        "hp_weight": 0.35,
        "ev_weight": 0.70,
        "seats_weight": 0.50,
    },
    "Working Professional": {
        "price_weight": 0.60,
        "hp_weight": 0.65,
        "ev_weight": 0.65,
        "seats_weight": 0.60,
    },
    "Business Owner": {
        "price_weight": 0.35,
        "hp_weight": 0.85,
        "ev_weight": 0.60,
        "seats_weight": 0.65,
    },
    "Family-Oriented": {
        "price_weight": 0.65,
        "hp_weight": 0.45,
        "ev_weight": 0.60,
        "seats_weight": 0.90,
    },
    "Retired": {
        "price_weight": 0.70,
        "hp_weight": 0.30,
        "ev_weight": 0.55,
        "seats_weight": 0.60,
    },
    "Others": {
        "price_weight": 0.55,
        "hp_weight": 0.55,
        "ev_weight": 0.55,
        "seats_weight": 0.55,
    },
}

HOBBY_MAP: Dict[str, Dict[str, float]] = {
    "City Life & Socializing": {
        "cargo_weight": 0.35,
        "suv_pref": 0.30,
        "range_weight": 0.45,
        "torque_weight": 0.45,
    },
    "Adventure & Travel": {
        "cargo_weight": 0.75,
        "suv_pref": 0.85,
        "range_weight": 0.85,
        "torque_weight": 0.70,
    },
    "Relaxed & Minimalist Lifestyle": {
        "cargo_weight": 0.30,
        "suv_pref": 0.35,
        "range_weight": 0.55,
        "torque_weight": 0.30,
    },
    "Outdoor Sports & Fitness": {
        "cargo_weight": 0.70,
        "suv_pref": 0.80,
        "range_weight": 0.75,
        "torque_weight": 0.65,
    },
}

USAGE_MAP: Dict[str, Dict[str, float]] = {
    "City commuting": {
        "suv_pref": 0.35,
        "sedan_pref": 0.70,
        "efficiency_weight": 0.85,
        "cargo_weight": 0.30,
        "range_weight": 0.45,
    },
    "Cargo & Practical use": {
        "suv_pref": 0.80,
        "sedan_pref": 0.25,
        "efficiency_weight": 0.50,
        "cargo_weight": 0.90,
        "range_weight": 0.55,
    },
    "Highway/Long-distance": {
        "suv_pref": 0.55,
        "sedan_pref": 0.60,
        "efficiency_weight": 0.65,
        "cargo_weight": 0.45,
        "range_weight": 0.90,
    },
    "Eco-conscious lifestyle": {
        "suv_pref": 0.45,
        "sedan_pref": 0.55,
        "efficiency_weight": 0.95,
        "cargo_weight": 0.30,
        "range_weight": 0.70,
    },
}

DAILY_DISTANCE_MAP: Dict[str, Dict[str, float]] = {
    "Short distance (0-30 km)": {
        "ev_weight": 0.80,
        "hev_weight": 0.60,
        "ice_weight": 0.35,
        "range_priority": 0.35,
    },
    "Medium commute (30-80 km)": {
        "ev_weight": 0.75,
        "hev_weight": 0.65,
        "ice_weight": 0.45,
        "range_priority": 0.60,
    },
    "Long commute (80-150 km)": {
        "ev_weight": 0.70,
        "hev_weight": 0.75,
        "ice_weight": 0.65,
        "range_priority": 0.80,
    },
    "Very long distance (Over 150 km)": {
        "ev_weight": 0.60,
        "hev_weight": 0.80,
        "ice_weight": 0.75,
        "range_priority": 0.95,
    },
}


FEATURE_ORDER: List[str] = [
    "price_weight",
    "hp_weight",
    "seats_weight",
    "range_weight",
    "cargo_weight",
    "torque_weight",
    "suv_pref",
    "sedan_pref",
    "fuel_ev_weight",
    "fuel_hev_weight",
    "fuel_ice_weight",
    "efficiency_weight",
]


def _norm_label(s: Any) -> str:
    if s is None:
        return ""
    out = str(s).strip().lower()
    dash_variants = ["–", "—", "−", "_", " to "]
    for d in dash_variants:
        out = out.replace(d, "-")
    out = out.replace("  ", " ")
    out = " ".join(out.split())
    return out


def minmax_series(series: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce")
    if numeric.isna().all():
        return pd.Series(np.full(len(series), 0.5), index=series.index, dtype=float)
    min_val = float(numeric.min(skipna=True))
    max_val = float(numeric.max(skipna=True))
    if np.isclose(max_val, min_val):
        return pd.Series(np.full(len(series), 0.5), index=series.index, dtype=float)
    norm = (numeric - min_val) / (max_val - min_val)
    return norm.fillna(0.5).astype(float)


def average_map(
    selected_list: Optional[Sequence[str]],
    MAP: Mapping[str, Mapping[str, float]],
    keys: Sequence[str],
    default: float = 0.5,
) -> Dict[str, float]:
    selected = selected_list or []
    norm_map = {_norm_label(k): v for k, v in MAP.items()}
    bucket: List[Mapping[str, float]] = []
    for item in selected:
        m = norm_map.get(_norm_label(item))
        if m:
            bucket.append(m)

    if not bucket:
        return {k: float(default) for k in keys}

    out: Dict[str, float] = {}
    for key in keys:
        vals = [float(b.get(key, default)) for b in bucket]
        out[key] = float(np.mean(vals)) if vals else float(default)
    return out


def _mapped_by_normalized_key(label: Any, mapping: Mapping[str, Any]) -> Any:
    norm = _norm_label(label)
    norm_lookup = {_norm_label(k): v for k, v in mapping.items()}
    return norm_lookup.get(norm)


def apply_choice_conversions(user_input: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(user_input)

    if out.get("max_price_thb") is None and out.get("budget_choice"):
        mapped_budget = _mapped_by_normalized_key(out.get("budget_choice"), BUDGET_MAP)
        out["max_price_thb"] = mapped_budget

    min_seats: Optional[int] = out.get("min_seats")
    max_seats: Optional[int] = out.get("max_seats")
    if out.get("seat_choice"):
        mapped_seats = _mapped_by_normalized_key(out.get("seat_choice"), SEATS_MAP)
        if mapped_seats:
            min_seats = mapped_seats.get("min_seats")
            max_seats = mapped_seats.get("max_seats")
    out["min_seats"] = min_seats
    out["max_seats"] = max_seats

    return out


def _clamp01(x: float) -> float:
    return float(max(0.0, min(1.0, x)))


def build_user_vector_from_quiz(
    user_input: Dict[str, Any],
    section_weights: Optional[Dict[str, float]] = None,
    debug: bool = False,
) -> Tuple[Dict[str, float], List[float], List[str]]:
    if section_weights is None:
        section_weights = {
            "occupation": 0.30,
            "hobbies": 0.25,
            "usage": 0.25,
            "daily_distance": 0.20,
        }

    occupation = user_input.get("occupation") or "Others"
    hobbies = user_input.get("hobbies") or []
    usage = user_input.get("usage") or []
    daily_distance = user_input.get("daily_distance") or "Medium commute (30-80 km)"

    occ_vec = _mapped_by_normalized_key(occupation, OCCUPATION_MAP) or OCCUPATION_MAP["Others"]
    hobby_avg = average_map(
        hobbies,
        HOBBY_MAP,
        ["cargo_weight", "suv_pref", "range_weight", "torque_weight"],
        default=0.5,
    )
    usage_avg = average_map(
        usage,
        USAGE_MAP,
        ["suv_pref", "sedan_pref", "efficiency_weight", "cargo_weight", "range_weight"],
        default=0.5,
    )
    dd_vec = _mapped_by_normalized_key(daily_distance, DAILY_DISTANCE_MAP) or DAILY_DISTANCE_MAP[
        "Medium commute (30-80 km)"
    ]

    combined: Dict[str, float] = {k: 0.0 for k in FEATURE_ORDER}

    occ_w = float(section_weights.get("occupation", 0.30))
    combined["price_weight"] += occ_w * float(occ_vec.get("price_weight", 0.5))
    combined["hp_weight"] += occ_w * float(occ_vec.get("hp_weight", 0.5))
    combined["seats_weight"] += occ_w * float(occ_vec.get("seats_weight", 0.5))
    combined["fuel_ev_weight"] += occ_w * float(occ_vec.get("ev_weight", 0.5))

    hobby_w = float(section_weights.get("hobbies", 0.25))
    combined["cargo_weight"] += hobby_w * float(hobby_avg.get("cargo_weight", 0.5))
    combined["torque_weight"] += hobby_w * float(hobby_avg.get("torque_weight", 0.5))
    combined["range_weight"] += hobby_w * float(hobby_avg.get("range_weight", 0.5))
    combined["suv_pref"] += hobby_w * float(hobby_avg.get("suv_pref", 0.5))

    usage_w = float(section_weights.get("usage", 0.25))
    combined["cargo_weight"] += usage_w * float(usage_avg.get("cargo_weight", 0.5))
    combined["range_weight"] += usage_w * float(usage_avg.get("range_weight", 0.5))
    combined["suv_pref"] += usage_w * float(usage_avg.get("suv_pref", 0.5))
    combined["sedan_pref"] += usage_w * float(usage_avg.get("sedan_pref", 0.5))
    combined["efficiency_weight"] += usage_w * float(usage_avg.get("efficiency_weight", 0.5))

    dd_w = float(section_weights.get("daily_distance", 0.20))
    combined["fuel_ev_weight"] += dd_w * float(dd_vec.get("ev_weight", 0.5))
    combined["fuel_hev_weight"] += dd_w * float(dd_vec.get("hev_weight", 0.5))
    combined["fuel_ice_weight"] += dd_w * float(dd_vec.get("ice_weight", 0.5))
    combined["range_weight"] += dd_w * float(dd_vec.get("range_priority", 0.5))

    fuel_sum = (
        combined["fuel_ev_weight"] + combined["fuel_hev_weight"] + combined["fuel_ice_weight"]
    )
    if fuel_sum > 0:
        combined["fuel_ev_weight"] /= fuel_sum
        combined["fuel_hev_weight"] /= fuel_sum
        combined["fuel_ice_weight"] /= fuel_sum

    for key in FEATURE_ORDER:
        combined[key] = _clamp01(combined[key])

    user_vector = [combined[k] for k in FEATURE_ORDER]

    if debug:
        print("=== User Input ===")
        print(user_input)
        print("=== User Vector Features ===")
        for k in FEATURE_ORDER:
            print(f"{k}: {combined[k]:.4f}")

    return combined, user_vector, FEATURE_ORDER


def _safe_numeric_col(df: pd.DataFrame, col: str, default: float = 0.0) -> pd.Series:
    if col in df.columns:
        return pd.to_numeric(df[col], errors="coerce").fillna(default).astype(float)
    return pd.Series(np.full(len(df), default), index=df.index, dtype=float)


def _contains_any(text: str, terms: Iterable[str]) -> bool:
    t = _norm_label(text)
    return any(term in t for term in terms)


def apply_constraints(car_df: pd.DataFrame, user_input: Dict[str, Any]) -> pd.DataFrame:
    df = car_df.copy()

    max_price = user_input.get("max_price_thb")
    if max_price is not None:
        if "price_thb" in df.columns:
            price = pd.to_numeric(df["price_thb"], errors="coerce")
            df = df.loc[price <= float(max_price)]
        else:
            df = df.iloc[0:0]

    min_seats = user_input.get("min_seats")
    max_seats = user_input.get("max_seats")
    if min_seats is not None or max_seats is not None:
        if "seats" in df.columns:
            seats = pd.to_numeric(df["seats"], errors="coerce")
            if min_seats is not None:
                df = df.loc[seats >= int(min_seats)]
            if max_seats is not None:
                df = df.loc[seats <= int(max_seats)]
        else:
            df = df.iloc[0:0]

    if int(user_input.get("fuel_type_EV", 0) or 0) == 1:
        if "fuel_type_EV" in df.columns:
            ev = pd.to_numeric(df["fuel_type_EV"], errors="coerce").fillna(0)
            df = df.loc[ev >= 1]
        elif "fuel_type" in df.columns:
            fuel_text = df["fuel_type"].fillna("").astype(str)
            is_ev = fuel_text.apply(
                lambda s: _contains_any(s, ["ev", "electric"])
                and not _contains_any(s, ["hev", "hybrid", "plug-in hybrid", "phev"])
            )
            df = df.loc[is_ev]
        else:
            df = df.iloc[0:0]

    return df.copy()


def prepare_car_vectors(car_df: pd.DataFrame) -> pd.DataFrame:
    df = car_df.copy()

    price = _safe_numeric_col(df, "price_thb", default=0.0)
    hp = _safe_numeric_col(df, "horsepower_hp", default=0.0)
    seats = _safe_numeric_col(df, "seats", default=0.0)
    rng = _safe_numeric_col(df, "range_km", default=0.0)
    cargo = _safe_numeric_col(df, "cargo_liters", default=0.0)

    df["_price_norm"] = minmax_series(price)
    df["_hp_norm"] = minmax_series(hp)
    df["_seats_norm"] = minmax_series(seats)
    df["_range_norm"] = minmax_series(rng)
    df["_cargo_norm"] = minmax_series(cargo)

    if "torque_nm" in df.columns:
        torque = _safe_numeric_col(df, "torque_nm", default=0.0)
        df["_torque_norm"] = minmax_series(torque)
    else:
        df["_torque_norm"] = df["_hp_norm"]

    if "fuel_consumption_kml" in df.columns:
        eff = _safe_numeric_col(df, "fuel_consumption_kml", default=np.nan)
        df["_eff_norm"] = minmax_series(eff.fillna(eff.mean() if not eff.dropna().empty else 0.5))
    else:
        df["_eff_norm"] = 0.5

    if "body_type_SUV" in df.columns:
        df["_is_suv"] = pd.to_numeric(df["body_type_SUV"], errors="coerce").fillna(0).clip(0, 1)
    else:
        body_text = df["body_type"].fillna("").astype(str) if "body_type" in df.columns else ""
        if isinstance(body_text, str):
            df["_is_suv"] = 0.0
        else:
            df["_is_suv"] = body_text.apply(lambda s: 1.0 if _contains_any(s, ["suv", "mpv", "pickup"]) else 0.0)

    if "body_type_Sedan" in df.columns:
        df["_is_sedan"] = pd.to_numeric(df["body_type_Sedan"], errors="coerce").fillna(0).clip(0, 1)
    else:
        body_text = df["body_type"].fillna("").astype(str) if "body_type" in df.columns else ""
        if isinstance(body_text, str):
            df["_is_sedan"] = 0.0
        else:
            df["_is_sedan"] = body_text.apply(
                lambda s: 1.0 if _contains_any(s, ["sedan", "hatchback", "wagon"]) else 0.0
            )

    if "fuel_type_EV" in df.columns:
        df["_is_ev"] = pd.to_numeric(df["fuel_type_EV"], errors="coerce").fillna(0).clip(0, 1)
    else:
        fuel_text = df["fuel_type"].fillna("").astype(str) if "fuel_type" in df.columns else ""
        if isinstance(fuel_text, str):
            df["_is_ev"] = 0.0
        else:
            df["_is_ev"] = fuel_text.apply(
                lambda s: 1.0
                if _contains_any(s, ["ev", "electric"])
                and not _contains_any(s, ["hev", "hybrid", "plug-in hybrid", "phev"])
                else 0.0
            )

    if "fuel_type_HEV" in df.columns:
        df["_is_hev"] = pd.to_numeric(df["fuel_type_HEV"], errors="coerce").fillna(0).clip(0, 1)
    else:
        fuel_text = df["fuel_type"].fillna("").astype(str) if "fuel_type" in df.columns else ""
        if isinstance(fuel_text, str):
            df["_is_hev"] = 0.0
        else:
            df["_is_hev"] = fuel_text.apply(
                lambda s: 1.0 if _contains_any(s, ["hev", "hybrid", "plug-in hybrid", "phev"]) else 0.0
            )

    if "fuel_type_ICE" in df.columns:
        df["_is_ice"] = pd.to_numeric(df["fuel_type_ICE"], errors="coerce").fillna(0).clip(0, 1)
    else:
        df["_is_ice"] = ((1 - df["_is_ev"]) * (1 - df["_is_hev"])).clip(0, 1)

    df["price_weight"] = df["_price_norm"]
    df["hp_weight"] = df["_hp_norm"]
    df["seats_weight"] = df["_seats_norm"]
    df["range_weight"] = df["_range_norm"]
    df["cargo_weight"] = df["_cargo_norm"]
    df["torque_weight"] = df["_torque_norm"]
    df["suv_pref"] = df["_is_suv"]
    df["sedan_pref"] = df["_is_sedan"]
    df["fuel_ev_weight"] = df["_is_ev"]
    df["fuel_hev_weight"] = df["_is_hev"]
    df["fuel_ice_weight"] = df["_is_ice"]
    df["efficiency_weight"] = df["_eff_norm"]

    return df


def recommend_top_n(
    car_df: pd.DataFrame,
    user_input: Dict[str, Any],
    top_n: int = 3,
    debug: bool = False,
) -> Tuple[pd.DataFrame, Optional[str]]:
    scored, user_profile, feature_cols, msg = score_cars_with_cosine(
        car_df=car_df,
        user_input=user_input,
        debug=debug,
    )
    if msg:
        return pd.DataFrame(), msg

    filtered = scored.sort_values("similarity_score", ascending=False).head(int(top_n))
    out_cols = [c for c in ["model", "variant", "price_thb", "seats", "similarity_score"] if c in filtered.columns]
    return filtered[out_cols].reset_index(drop=True), None


def score_cars_with_cosine(
    car_df: pd.DataFrame,
    user_input: Dict[str, Any],
    debug: bool = False,
) -> Tuple[pd.DataFrame, Dict[str, float], List[str], Optional[str]]:
    converted = apply_choice_conversions(user_input)
    filtered = apply_constraints(car_df, converted)

    if filtered.empty:
        return pd.DataFrame(), {}, FEATURE_ORDER.copy(), "No cars match the hard constraints."

    filtered = prepare_car_vectors(filtered)
    user_profile, user_vec, feature_cols = build_user_vector_from_quiz(converted, debug=debug)

    car_matrix = filtered[feature_cols].fillna(0.0).to_numpy(dtype=float)
    user_matrix = np.array(user_vec, dtype=float).reshape(1, -1)
    sims = cosine_similarity(car_matrix, user_matrix).reshape(-1)

    filtered = filtered.copy()
    filtered["similarity_score"] = sims

    if debug:
        print("=== User Profile Vector ===")
        print(user_profile)
        print("=== Similarity Computed for", len(filtered), "cars ===")

    return filtered, user_profile, feature_cols, None


def _demo_dataframe() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "model": "MG4 Electric",
                "variant": "D",
                "price_thb": 709_900,
                "horsepower_hp": 170,
                "seats": 5,
                "range_km": 423,
                "cargo_liters": 363,
                "torque_nm": 250,
                "fuel_consumption_kml": np.nan,
                "body_type": "Hatchback",
                "fuel_type": "EV",
                "fuel_type_EV": 1,
                "fuel_type_HEV": 0,
                "fuel_type_ICE": 0,
            },
            {
                "model": "MG S5 EV",
                "variant": "X+",
                "price_thb": 839_900,
                "horsepower_hp": 170,
                "seats": 5,
                "range_km": 416,
                "cargo_liters": 479,
                "torque_nm": 250,
                "fuel_consumption_kml": np.nan,
                "body_type": "SUV",
                "fuel_type": "EV",
                "fuel_type_EV": 1,
                "fuel_type_HEV": 0,
                "fuel_type_ICE": 0,
            },
            {
                "model": "MG VS HEV",
                "variant": "X",
                "price_thb": 919_000,
                "horsepower_hp": 177,
                "seats": 5,
                "range_km": 1171,
                "cargo_liters": 448,
                "torque_nm": 200,
                "fuel_consumption_kml": 24.4,
                "body_type": "SUV",
                "fuel_type": "Hybrid",
                "fuel_type_EV": 0,
                "fuel_type_HEV": 1,
                "fuel_type_ICE": 0,
            },
            {
                "model": "MG5",
                "variant": "PRO X",
                "price_thb": 699_000,
                "horsepower_hp": 114,
                "seats": 5,
                "range_km": 780,
                "cargo_liters": 562,
                "torque_nm": 150,
                "fuel_consumption_kml": 15.6,
                "body_type": "Sedan",
                "fuel_type": "Petrol",
                "fuel_type_EV": 0,
                "fuel_type_HEV": 0,
                "fuel_type_ICE": 1,
            },
            {
                "model": "MG ZS EV",
                "variant": "X",
                "price_thb": 899_900,
                "horsepower_hp": 177,
                "seats": 5,
                "range_km": 403,
                "cargo_liters": 448,
                "torque_nm": 280,
                "fuel_consumption_kml": np.nan,
                "body_type": "SUV",
                "fuel_type": "EV",
                "fuel_type_EV": 1,
                "fuel_type_HEV": 0,
                "fuel_type_ICE": 0,
            },
            {
                "model": "MG Maxus 7",
                "variant": "X",
                "price_thb": 1_769_000,
                "horsepower_hp": 245,
                "seats": 7,
                "range_km": 550,
                "cargo_liters": 790,
                "torque_nm": 350,
                "fuel_consumption_kml": np.nan,
                "body_type": "MPV",
                "fuel_type": "EV",
                "fuel_type_EV": 1,
                "fuel_type_HEV": 0,
                "fuel_type_ICE": 0,
            },
            {
                "model": "MG3 Hybrid+",
                "variant": "X",
                "price_thb": 619_900,
                "horsepower_hp": 194,
                "seats": 5,
                "range_km": 943,
                "cargo_liters": 293,
                "torque_nm": 250,
                "fuel_consumption_kml": 26.2,
                "body_type": "Hatchback",
                "fuel_type": "Hybrid",
                "fuel_type_EV": 0,
                "fuel_type_HEV": 1,
                "fuel_type_ICE": 0,
            },
            {
                "model": "MG4 Electric",
                "variant": "XPOWER",
                "price_thb": 1_119_900,
                "horsepower_hp": 435,
                "seats": 5,
                "range_km": 480,
                "cargo_liters": 363,
                "torque_nm": 600,
                "fuel_consumption_kml": np.nan,
                "body_type": "Hatchback",
                "fuel_type": "EV",
                "fuel_type_EV": 1,
                "fuel_type_HEV": 0,
                "fuel_type_ICE": 0,
            },
        ]
    )


def _demo() -> None:
    car_df = _demo_dataframe()
    user_input = {
        "budget_choice": "700,000 – 999,999 THB",
        "seat_choice": "5+ seats",
        "fuel_type_EV": 1,
        "occupation": "Student",
        "hobbies": ["Adventure & Travel", "Outdoor Sports & Fitness"],
        "usage": ["City commuting", "Eco-conscious lifestyle"],
        "daily_distance": "Medium commute (30–80 km)",
    }

    result, msg = recommend_top_n(car_df, user_input, top_n=3, debug=True)
    print("\n=== Recommendation Result ===")
    if msg:
        print(msg)
    else:
        print(result.to_string(index=False))


if __name__ == "__main__":
    _demo()
