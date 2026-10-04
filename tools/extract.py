#!/usr/bin/env python3
"""Extrait la liste des centrales de l'ancienne page HTML vers data/centrales.json.

Usage : python3 tools/extract.py [source/navigation-centrales-original.html]
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "source" / "navigation-centrales-original.html"
text = src.read_text(encoding="utf-8")

cards = re.findall(
    r'<div class="card-title">(.*?)</div>.*?waze\.com/ul\?ll=([-\d.]+),([-\d.]+)',
    text,
    re.S,
)


def region(lat: float, lon: float) -> str:
    if lat < 0 and 54 < lon < 57:
        return "La Réunion"
    if 1 < lat < 7 and -55 < lon < -51:
        return "Guyane"
    return ""


out = []
for name, lat, lon in cards:
    lat, lon = float(lat), float(lon)
    item = {"n": html.unescape(name).strip(), "lat": lat, "lon": lon}
    r = region(lat, lon)
    if r:
        item["r"] = r
    out.append(item)

dest = ROOT / "data" / "centrales.json"
dest.write_text(
    "[\n" + ",\n".join(json.dumps(o, ensure_ascii=False) for o in out) + "\n]\n",
    encoding="utf-8",
)
print(f"{len(out)} centrales -> {dest.relative_to(ROOT)}")
