#!/usr/bin/env python3
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
XLSX = ROOT / "MG_Car_Dataset.xlsx"
if not XLSX.exists():
    XLSX = ROOT / "MG_Dataset.xlsx"
FRONTEND_VARIANTS = ROOT / "mgnition-frontend" / "src" / "data" / "modelVariants.json"
BACKEND_VARIANTS = ROOT / "backend" / "data" / "modelVariants.json"
FRONTEND_MODELS = ROOT / "mgnition-frontend" / "src" / "data" / "models.json"

NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
COLOR_WORDS = [
    "white",
    "black",
    "red",
    "blue",
    "silver",
    "grey",
    "gray",
    "green",
    "orange",
    "yellow",
    "beige",
    "brown",
    "pink",
    "purple",
]


def col_idx(ref):
    letters = "".join(ch for ch in ref if ch.isalpha())
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


def parse_sheet_rows(xlsx_path):
    with zipfile.ZipFile(xlsx_path) as z:
        sst = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("a:si", NS):
                sst.append("".join(t.text or "" for t in si.findall(".//a:t", NS)))

        root = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        rows = root.findall(".//a:sheetData/a:row", NS)
        headers = []
        out = []

        for ri, row in enumerate(rows):
            vals = {}
            for c in row.findall("a:c", NS):
                idx = col_idx(c.attrib.get("r", "A1"))
                t = c.attrib.get("t")
                v = c.find("a:v", NS)
                val = ""
                if v is not None:
                    raw = v.text or ""
                    if t == "s":
                        try:
                            val = sst[int(raw)]
                        except Exception:
                            val = raw
                    else:
                        val = raw
                else:
                    isel = c.find("a:is", NS)
                    if isel is not None:
                        val = "".join(tn.text or "" for tn in isel.findall(".//a:t", NS))
                vals[idx] = val

            if ri == 0:
                maxc = max(vals) if vals else 0
                headers = [vals.get(i, "") for i in range(1, maxc + 1)]
                continue
            if not vals:
                continue

            row_obj = {headers[i - 1]: str(vals.get(i, "")).strip() for i in range(1, len(headers) + 1)}
            if not row_obj.get("Model"):
                continue
            out.append(row_obj)
    return out


def looks_like_image_url(v):
    s = str(v or "").strip()
    return bool(re.match(r"^https?://.+\.(png|jpe?g|webp|gif|avif)(\?.*)?$", s, flags=re.I))


def normalize_color_label(raw):
    return (
        str(raw or "")
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


def extract_color_images(row, headers):
    # Business rule from UI spec:
    # - Column R (Image_URL) is ignored
    # - Color columns start from column S onward
    out = {}
    for idx in range(19, len(headers) + 1):
        header = str(headers[idx - 1] or "").strip()
        if not header:
            continue
        val = str(row.get(header, "")).strip()
        if not val or val in {"-", "."}:
            continue
        if not looks_like_image_url(val):
            continue
        out[header] = val
    return out


def to_float(raw):
    try:
        return float(str(raw).replace(",", ""))
    except Exception:
        return float("inf")


def main():
    rows = parse_sheet_rows(XLSX)
    headers = list(rows[0].keys()) if rows else []

    cleaned_rows = []
    for r in rows:
        item = {k: v for k, v in r.items() if k != "Image_URL"}
        color_images = extract_color_images(r, headers)
        if color_images:
            item["Color_Images"] = color_images
            item["Default_Color"] = next(iter(color_images))
        cleaned_rows.append(item)

    for out_path in [FRONTEND_VARIANTS, BACKEND_VARIANTS]:
        out_path.write_text(json.dumps(cleaned_rows, indent=2, ensure_ascii=False))

    by_model = {}
    for r in cleaned_rows:
        model = r.get("Model", "").strip()
        if not model:
            continue
        price = to_float(r.get("Price_THB"))
        if model in by_model and price >= by_model[model]["_price_num"]:
            continue
        color_images = r.get("Color_Images", {}) if isinstance(r.get("Color_Images"), dict) else {}
        default_color = r.get("Default_Color", "") or (next(iter(color_images)) if color_images else "")
        by_model[model] = {
            "model": model,
            "price": f"{int(price):,} THB" if price != float("inf") else "N/A",
            "fuel": r.get("Fuel_Type", ""),
            "seats": r.get("Seats", ""),
            "bodyType": r.get("Body_Type", ""),
            "colorImages": color_images,
            "defaultColor": default_color,
            "_price_num": price,
        }

    models = []
    for _, item in by_model.items():
        item.pop("_price_num", None)
        models.append(item)
    models.sort(key=lambda x: x["model"])
    FRONTEND_MODELS.write_text(json.dumps(models, indent=2, ensure_ascii=False))

    print(f"Synced {len(cleaned_rows)} variants and {len(models)} models.")


if __name__ == "__main__":
    main()
