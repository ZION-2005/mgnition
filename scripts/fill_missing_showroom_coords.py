#!/usr/bin/env python3
"""
Fill missing showroom coordinates in showrooms.json via Google Geocoding API.

Usage:
  python3 scripts/fill_missing_showroom_coords.py \
    --showrooms mgnition-frontend/src/data/showrooms.json \
    --api-key "$VITE_GOOGLE_MAPS_API_KEY" \
    --write
"""

from __future__ import annotations

import argparse
import json
import math
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def parse_float(value: Any) -> Optional[float]:
    try:
        num = float(value)
        if math.isnan(num):
            return None
        return num
    except Exception:
        return None


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def postal_from_address(address: str) -> str:
    m = re.search(r"(\d{5})\s*$", address or "")
    return m.group(1) if m else ""


def province_from_address(address: str) -> str:
    text = str(address or "")
    m = re.search(r",\s*([^,\d]+?)\s*(?:province)?\s*\d{5}\s*$", text, flags=re.I)
    if not m:
        return ""
    return normalize_text(m.group(1).replace("Province", ""))


def province_aliases(province: str) -> List[str]:
    base = normalize_text(province)
    alias_map = {
        "bangkok": ["krung thep maha nakhon", "krung thep", "กรุงเทพมหานคร"],
        "samut prakan": ["chang wat samut prakan", "สมุทรปราการ"],
        "ayutthaya": ["phra nakhon si ayutthaya", "พระนครศรีอยุธยา"],
        "nakhon pathom": ["chang wat nakhon pathom", "นครปฐม"],
        "lopburi": ["lop buri", "chang wat lopburi", "ลพบุรี"],
        "nakhon ratchasima": ["korat", "chang wat nakhon ratchasima", "นครราชสีมา"],
        "surat thani": ["chang wat surat thani", "สุราษฎร์ธานี"],
        "sakon nakhon": ["chang wat sakon nakhon", "สกลนคร"],
        "pattani": ["chang wat pattani", "ปัตตานี"],
        "narathiwat": ["chang wat narathiwat", "นราธิวาส"],
    }
    aliases = alias_map.get(base, [])
    out = [base]
    out.extend(aliases)
    return [normalize_text(x) for x in out if x]


def is_inside_thailand(lat: float, lng: float) -> bool:
    return 5.0 <= lat <= 21.0 and 97.0 <= lng <= 106.5


def geocode(address: str, api_key: str) -> Tuple[str, List[Dict[str, Any]]]:
    params = {"address": address, "region": "th", "key": api_key}
    url = "https://maps.googleapis.com/maps/api/geocode/json?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    status = str(payload.get("status", "UNKNOWN"))
    results = payload.get("results") or []
    return status, results


def pick_candidate(results: List[Dict[str, Any]], showroom: Dict[str, Any]) -> Optional[Tuple[float, float]]:
    expected_postal = postal_from_address(str(showroom.get("address", "")))
    expected_province = province_from_address(str(showroom.get("address", "")))
    province_keys = province_aliases(expected_province)
    expected_name = normalize_text(str(showroom.get("name", "")))
    expected_addr = normalize_text(str(showroom.get("address", "")))

    best: Optional[Tuple[float, float]] = None
    best_score = -1

    for result in results:
        geom = (result.get("geometry") or {}).get("location") or {}
        lat = parse_float(geom.get("lat"))
        lng = parse_float(geom.get("lng"))
        if lat is None or lng is None or not is_inside_thailand(lat, lng):
            continue

        formatted = normalize_text(result.get("formatted_address", ""))
        comps = result.get("address_components") or []
        text_parts = [formatted]
        for c in comps:
            text_parts.append(normalize_text(c.get("long_name", "")))
            text_parts.append(normalize_text(c.get("short_name", "")))
        text = " ".join(x for x in text_parts if x)

        province_ok = any(pk and pk in text for pk in province_keys) if province_keys else False
        postal_ok = bool(expected_postal and expected_postal in text)
        lexical_hits = 0
        for token in (expected_name + " " + expected_addr).split():
            if len(token) < 5:
                continue
            if token in text:
                lexical_hits += 1

        score = 0
        if province_ok:
            score += 6
        if postal_ok:
            score += 8
        score += min(lexical_hits, 5)

        if score > best_score and (province_ok or postal_ok or lexical_hits > 0):
            best_score = score
            best = (round(lat, 6), round(lng, 6))

    return best


def main() -> int:
    parser = argparse.ArgumentParser(description="Fill missing showroom coordinates via Google geocoding.")
    parser.add_argument("--showrooms", required=True, help="Path to showrooms.json")
    parser.add_argument("--api-key", required=True, help="Google Maps API key")
    parser.add_argument("--sleep", type=float, default=0.15, help="Sleep between requests")
    parser.add_argument("--write", action="store_true", help="Write changes to file")
    args = parser.parse_args()

    showrooms_path = Path(args.showrooms).expanduser().resolve()
    showrooms = json.loads(showrooms_path.read_text())

    updated = 0
    failed: List[Tuple[str, str]] = []

    for row in showrooms:
        lat = parse_float(row.get("lat"))
        lng = parse_float(row.get("lng"))
        if lat is not None and lng is not None:
            continue

        name = str(row.get("name", "")).strip()
        address = str(row.get("address", "")).strip()
        queries = [
            f"{name}, {address}, Thailand",
            f"{address}, Thailand",
            f"{name}, Thailand",
        ]

        resolved: Optional[Tuple[float, float]] = None
        last_status = "UNKNOWN"
        for q in queries:
            status, results = geocode(q, args.api_key)
            last_status = status
            if status == "OK" and results:
                candidate = pick_candidate(results, row)
                if candidate:
                    resolved = candidate
                    break
            time.sleep(args.sleep)

        if not resolved:
            failed.append((name, last_status))
            continue

        row["lat"], row["lng"] = resolved
        updated += 1
        print(f"UPDATED: {name} -> {row['lat']}, {row['lng']}")

    print(f"\nUpdated rows: {updated}")
    print(f"Failed rows: {len(failed)}")
    for name, status in failed:
        print(f"- {name} (status: {status})")

    if args.write:
        showrooms_path.write_text(json.dumps(showrooms, indent=2, ensure_ascii=False) + "\n")
        print(f"\nWrote file: {showrooms_path}")
    else:
        print("\nDry run only. Add --write to save.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

