#!/usr/bin/env python3
"""
Sync showroom data from an official Excel source into showrooms.json.

Features:
- Reads XLSX showroom list.
- Uses provided coordinates when available.
- If coordinates are missing, tries to extract from Google Maps links.
- If still missing and API key is provided, geocodes by address.
- Deduplicates against existing data.
- Optionally fixes existing coordinates when source is authoritative.

Example:
  python scripts/sync_showrooms.py \
    --input "/Users/khaingzawlin/Downloads/MG showrooms (1).xlsx" \
    --showrooms "/Users/khaingzawlin/Downloads/SeniorProject_New 3/mgnition-frontend/src/data/showrooms.json" \
    --api-key "$VITE_GOOGLE_MAPS_API_KEY" \
    --fix-existing \
    --write
"""

from __future__ import annotations

import argparse
import difflib
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    s = str(value).strip().lower()
    if s in {"nan", "none", "-", ""}:
        return ""
    s = s.replace("\n", " ").replace("\r", " ")
    s = re.sub(r"[^a-z0-9ก-๙ ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def clean_text(value: Any, default: str = "-") -> str:
    if value is None:
        return default
    s = str(value).replace("\n", " ").replace("\r", " ").strip()
    s = re.sub(r"\s+", " ", s)
    if s.lower() in {"nan", "none", ""}:
        return default
    return s


def parse_float(value: Any) -> Optional[float]:
    try:
        n = float(value)
        if math.isnan(n):
            return None
        return n
    except Exception:
        return None


def haversine_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    from math import atan2, cos, radians, sin, sqrt

    d_lat = radians(b_lat - a_lat)
    d_lng = radians(b_lng - a_lng)
    x = sin(d_lat / 2) ** 2 + cos(radians(a_lat)) * cos(radians(b_lat)) * sin(d_lng / 2) ** 2
    return 2 * 6371 * atan2(sqrt(x), sqrt(1 - x))


def province_prefix(address: str) -> str:
    a = normalize_text(address)
    if "bangkok" in a:
        return "BKK"
    if "samut prakan" in a:
        return "SPK"
    if "nonthaburi" in a:
        return "NON"
    if "pathum thani" in a:
        return "PT"
    if "ayutthaya" in a or "phra nakhon si ayutthaya" in a:
        return "AY"
    if "samut sakhon" in a:
        return "SSK"
    if "nakhon pathom" in a:
        return "NPT"
    return "EXT"


def resolve_redirect_url(url: str, timeout_sec: int = 15) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
        return resp.geturl() or url


def extract_coords_from_url(url: str) -> Tuple[Optional[float], Optional[float]]:
    if not url:
        return None, None
    text = urllib.parse.unquote(url)

    patterns = [
        r"@(-?\d+\.\d+),(-?\d+\.\d+)",
        r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)",
        r"[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)",
        r"[?&]query=(-?\d+\.\d+),(-?\d+\.\d+)",
    ]
    for p in patterns:
        m = re.search(p, text)
        if not m:
            continue
        lat = parse_float(m.group(1))
        lng = parse_float(m.group(2))
        if lat is None or lng is None:
            continue
        if -90 <= lat <= 90 and -180 <= lng <= 180:
            return lat, lng
    return None, None


def geocode_address(address: str, api_key: str, pause_sec: float = 0.15) -> Tuple[Optional[float], Optional[float], str]:
    params = {
        "address": address,
        "region": "th",
        "key": api_key,
    }
    url = "https://maps.googleapis.com/maps/api/geocode/json?" + urllib.parse.urlencode(params)

    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    status = str(data.get("status", "UNKNOWN"))
    if status != "OK":
        time.sleep(pause_sec)
        return None, None, status

    first = (data.get("results") or [None])[0] or {}
    loc = (((first.get("geometry") or {}).get("location")) or {})
    lat = parse_float(loc.get("lat"))
    lng = parse_float(loc.get("lng"))
    time.sleep(pause_sec)
    return lat, lng, status


def similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


def coord_match_score(source: SourceRow, existing: Dict[str, Any]) -> Optional[Tuple[float, float, float]]:
    s_lat, s_lng = source.lat, source.lng
    e_lat, e_lng = parse_float(existing.get("lat")), parse_float(existing.get("lng"))
    if s_lat is None or s_lng is None or e_lat is None or e_lng is None:
        return None

    km = haversine_km(s_lat, s_lng, e_lat, e_lng)
    if km > 0.9:
        return None

    name_s = similarity(source.name_n, existing["name_n"])
    addr_s = similarity(source.addr_n, existing["addr_n"])
    if name_s < 0.45 and addr_s < 0.45:
        return None

    return km, name_s, addr_s


@dataclass
class SourceRow:
    showroom_name: str
    address: str
    phone: str
    lat: Optional[float]
    lng: Optional[float]
    googlemap_link: str
    name_n: str
    addr_n: str
    coord_source: str


def load_source_rows(xlsx_path: Path, api_key: str) -> List[SourceRow]:
    df = pd.read_excel(xlsx_path)

    rows: List[SourceRow] = []
    for _, r in df.iterrows():
        name = clean_text(r.get("showroom_name"), default="")
        addr = clean_text(r.get("address"), default="")
        phone = clean_text(r.get("phone"), default="-")
        link = clean_text(r.get("googlemap_link"), default="")
        lat = parse_float(r.get("latitude"))
        lng = parse_float(r.get("longitude,"))
        coord_source = "sheet"

        if (lat is None or lng is None) and link:
            resolved = link
            try:
                if "maps.app.goo.gl" in link:
                    resolved = resolve_redirect_url(link)
                e_lat, e_lng = extract_coords_from_url(resolved)
                if e_lat is not None and e_lng is not None:
                    lat, lng = e_lat, e_lng
                    coord_source = "map_link"
            except Exception:
                pass

        if (lat is None or lng is None) and api_key and addr:
            try:
                g_lat, g_lng, status = geocode_address(addr, api_key)
                if g_lat is not None and g_lng is not None:
                    lat, lng = g_lat, g_lng
                    coord_source = f"geocode:{status}"
            except Exception:
                pass

        name_n = normalize_text(name)
        addr_n = normalize_text(addr)

        if not name_n or not addr_n:
            continue

        rows.append(
            SourceRow(
                showroom_name=name,
                address=addr,
                phone=phone,
                lat=round(lat, 6) if lat is not None else None,
                lng=round(lng, 6) if lng is not None else None,
                googlemap_link=link,
                name_n=name_n,
                addr_n=addr_n,
                coord_source=coord_source,
            )
        )
    return rows


def choose_best_source_rows(rows: List[SourceRow]) -> List[SourceRow]:
    # Pass 1: deduplicate by exact normalized name/address and keep richer rows.
    best_by_key: Dict[Tuple[str, str], SourceRow] = {}
    for r in rows:
        key = (r.name_n, r.addr_n)
        prev = best_by_key.get(key)
        if prev is None:
            best_by_key[key] = r
            continue

        prev_score = (prev.lat is not None and prev.lng is not None, len(prev.address), len(prev.showroom_name), prev.coord_source == "sheet")
        curr_score = (r.lat is not None and r.lng is not None, len(r.address), len(r.showroom_name), r.coord_source == "sheet")
        if curr_score > prev_score:
            best_by_key[key] = r

    # Pass 2: collapse near-coordinate duplicates with very similar names/addresses.
    out: List[SourceRow] = []
    for r in best_by_key.values():
        dup_idx = None
        for i, e in enumerate(out):
            score = coord_match_score(
                r,
                {
                    "name_n": e.name_n,
                    "addr_n": e.addr_n,
                    "lat": e.lat,
                    "lng": e.lng,
                },
            )
            if score is not None:
                dup_idx = i
                break

        if dup_idx is None:
            out.append(r)
            continue

        e = out[dup_idx]
        e_score = (e.lat is not None and e.lng is not None, len(e.address), len(e.showroom_name), e.coord_source == "sheet")
        r_score = (r.lat is not None and r.lng is not None, len(r.address), len(r.showroom_name), r.coord_source == "sheet")
        if r_score > e_score:
            out[dup_idx] = r

    return out


def find_existing_match(source: SourceRow, existing_rows: List[Dict[str, Any]]) -> Tuple[Optional[int], str]:
    # 1) exact address
    for i, e in enumerate(existing_rows):
        if source.addr_n and source.addr_n == e["addr_n"]:
            return i, "exact_address"

    # 2) exact name
    for i, e in enumerate(existing_rows):
        if source.name_n and source.name_n == e["name_n"]:
            return i, "exact_name"

    # 3) near-coordinate + moderate similarity (same branch with different naming style)
    best_idx = None
    best_km = None
    best_max_sim = -1.0
    for i, e in enumerate(existing_rows):
        score = coord_match_score(source, e)
        if score is None:
            continue
        km, name_s, addr_s = score
        max_sim = max(name_s, addr_s)
        if best_idx is None or (km < best_km) or (km == best_km and max_sim > best_max_sim):
            best_idx = i
            best_km = km
            best_max_sim = max_sim
    if best_idx is not None:
        return best_idx, "near_coord"

    # 4) very strong fuzzy name+address (conservative to avoid wrong updates)
    best_idx = None
    best_name = 0.0
    best_addr = 0.0
    for i, e in enumerate(existing_rows):
        name_s = similarity(source.name_n, e["name_n"])
        addr_s = similarity(source.addr_n, e["addr_n"])
        if (name_s, addr_s) > (best_name, best_addr):
            best_name = name_s
            best_addr = addr_s
            best_idx = i
    if best_idx is not None and best_name >= 0.93 and best_addr >= 0.75:
        return best_idx, "fuzzy_strong"
    return None, "none"


def next_ids_by_prefix(existing_json: List[Dict[str, Any]]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for r in existing_json:
        m = re.match(r"^([A-Z]+)(\d+)$", str(r.get("id", "")).strip())
        if not m:
            continue
        pfx, num = m.group(1), int(m.group(2))
        out[pfx] = max(out.get(pfx, 0), num)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync showroom data into showrooms.json")
    parser.add_argument("--input", required=True, help="Path to XLSX input")
    parser.add_argument("--showrooms", required=True, help="Path to showrooms.json")
    parser.add_argument("--api-key", default="", help="Google Maps API key (optional, for geocoding fallback)")
    parser.add_argument("--fix-existing", action="store_true", help="Fix existing lat/lng from source matches")
    parser.add_argument("--write", action="store_true", help="Write changes back to showrooms.json")
    args = parser.parse_args()

    in_path = Path(args.input).expanduser().resolve()
    showrooms_path = Path(args.showrooms).expanduser().resolve()
    if not in_path.exists():
        print(f"ERROR: input not found: {in_path}")
        return 1
    if not showrooms_path.exists():
        print(f"ERROR: showrooms file not found: {showrooms_path}")
        return 1

    existing_json = json.loads(showrooms_path.read_text())
    existing_rows: List[Dict[str, Any]] = []
    for r in existing_json:
        existing_rows.append(
            {
                "id": r.get("id"),
                "name_n": normalize_text(r.get("name")),
                "addr_n": normalize_text(r.get("address")),
                "lat": parse_float(r.get("lat")),
                "lng": parse_float(r.get("lng")),
            }
        )

    source_rows = choose_best_source_rows(load_source_rows(in_path, args.api_key.strip()))

    added: List[Dict[str, Any]] = []
    updated: List[Tuple[str, float, float]] = []
    skipped_missing_coord = 0

    id_counters = next_ids_by_prefix(existing_json)

    for src in source_rows:
        match_idx, match_type = find_existing_match(src, existing_rows)

        if match_idx is not None:
            if not args.fix_existing:
                continue

            if src.lat is None or src.lng is None:
                continue

            # Only auto-fix coordinates for reliable matches.
            if match_type not in {"exact_address", "exact_name", "near_coord", "fuzzy_strong"}:
                continue

            ex = existing_rows[match_idx]
            old_lat = parse_float(existing_json[match_idx].get("lat"))
            old_lng = parse_float(existing_json[match_idx].get("lng"))
            should_update = False

            if old_lat is None or old_lng is None:
                should_update = True
            else:
                km = haversine_km(old_lat, old_lng, src.lat, src.lng)
                if km > 0.3:
                    should_update = True

            if should_update:
                existing_json[match_idx]["lat"] = round(src.lat, 6)
                existing_json[match_idx]["lng"] = round(src.lng, 6)
                if str(existing_json[match_idx].get("phone", "-")).strip() in {"", "-", "nan"}:
                    existing_json[match_idx]["phone"] = src.phone
                updated.append((str(existing_json[match_idx].get("id", "")), src.lat, src.lng))
                ex["lat"] = src.lat
                ex["lng"] = src.lng
            continue

        if src.lat is None or src.lng is None:
            skipped_missing_coord += 1
            continue

        pfx = province_prefix(src.address)
        n = id_counters.get(pfx, 0) + 1
        id_counters[pfx] = n
        new_id = f"{pfx}{n:02d}"
        row = {
            "id": new_id,
            "name": src.showroom_name,
            "address": src.address,
            "lat": round(src.lat, 6),
            "lng": round(src.lng, 6),
            "phone": src.phone if src.phone else "-",
        }
        existing_json.append(row)
        existing_rows.append(
            {
                "id": new_id,
                "name_n": src.name_n,
                "addr_n": src.addr_n,
                "lat": src.lat,
                "lng": src.lng,
            }
        )
        added.append(row)

    print(f"Input rows parsed: {len(source_rows)}")
    print(f"New rows added: {len(added)}")
    print(f"Existing rows updated: {len(updated)}")
    print(f"Skipped (missing coordinates): {skipped_missing_coord}")

    if added:
        print("\nAdded IDs:")
        for r in added:
            print(f"- {r['id']}: {r['name']}")

    if updated:
        print("\nUpdated IDs:")
        for rid, lat, lng in updated:
            print(f"- {rid}: {lat:.6f}, {lng:.6f}")

    if args.write:
        showrooms_path.write_text(json.dumps(existing_json, indent=2, ensure_ascii=False) + "\n")
        print(f"\nWrote: {showrooms_path}")
    else:
        print("\nDry run only. Re-run with --write to apply.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
