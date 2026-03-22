from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import joblib
import pandas as pd
from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import LogisticRegression


def clean_str(v):
    return "" if v is None else str(v).strip()


def normalize_text(v):
    return clean_str(v).lower().replace("  ", " ").strip()


def split_multi(v):
    s = clean_str(v)
    if not s:
        return []
    return [x.strip() for x in s.split(",") if x.strip()]


def find_col(columns, fragments):
    cols = list(columns)
    lower_cols = {c: normalize_text(c) for c in cols}
    for frag in fragments:
        frag_n = normalize_text(frag)
        for c in cols:
            if frag_n in lower_cols[c]:
                return c
    return None


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


def to_feature_dict(row, colmap):
    feat = {}

    def push(prefix, value):
        v = normalize_text(value)
        if v:
            feat[f"{prefix}::{v}"] = 1

    push("occupation", row.get(colmap["occupation"]))
    push("budget", row.get(colmap["budget"]))
    push("seats", row.get(colmap["seats"]))
    push("fuel", row.get(colmap["fuel"]))
    push("distance", row.get(colmap["distance"]))
    push("usage", row.get(colmap["usage"]))

    for hobby in split_multi(row.get(colmap["hobbies"])):
        push("hobby", hobby)

    return feat


def build_colmap(df):
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
    return colmap


def train(csv_path, out_path):
    df = pd.read_csv(csv_path)
    colmap = build_colmap(df)


# xs = list of feature dicts
# ys = list of labels

    xs = []
    ys = []
    for _, row in df.iterrows():
        y = canonical_survey_choice_label(row.get(colmap["choice"]))
        if not y:
            continue
        feat = to_feature_dict(row, colmap)
        if not feat:
            continue
        xs.append(feat)
        ys.append(y)

    if len(xs) < 20:
        raise ValueError(f"Not enough usable rows for regression: {len(xs)}")
    if len(set(ys)) < 2:
        raise ValueError("Need at least 2 target classes for regression.")

    vec = DictVectorizer(sparse=True)
    X = vec.fit_transform(xs)
    clf = LogisticRegression(
        solver="lbfgs",
        class_weight="balanced",
        C=0.3,
        max_iter=4000,
        random_state=42,
    )
    clf.fit(X, ys)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    artifact = {
        "vectorizer": vec,
        "model": clf,
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "samples": len(ys),
        "class_counts": dict(Counter(ys)),
        "source_csv": str(csv_path),
    }
    joblib.dump(artifact, out_path)
    return artifact


def main():
    parser = argparse.ArgumentParser(description="Train survey-based multinomial regression.")
    parser.add_argument("--csv", required=True, help="Path to Google Forms CSV export.")
    parser.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parent / "models" / "survey_regression.joblib"),
        help="Output artifact path.",
    )
    args = parser.parse_args()

    csv_path = Path(args.csv).expanduser().resolve()
    out_path = Path(args.out).expanduser().resolve()
    artifact = train(csv_path, out_path)

    print(f"Saved survey regression model to: {out_path}")
    print(f"Samples: {artifact['samples']}")
    print(f"Classes: {artifact['class_counts']}")


if __name__ == "__main__":
    main()
