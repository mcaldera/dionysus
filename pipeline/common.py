"""Shared paths and helpers for the pipeline scripts."""

from __future__ import annotations

import csv
import subprocess
import sys
import time
import unicodedata
import re
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OWN = ROOT / "data" / "own"
INTERIM = ROOT / "data" / "interim"
REPORTS = ROOT / "reports"
PUBLIC_DATA = ROOT / "public" / "data"

# Smoking in Austrian gastronomy is banned since 2019, so what old reviews say about it must not
# reach the site. Not matched: Shisha, cigars on offer, and Rauchfang, Rauchbier and other food.
SMOKING = re.compile(r"\b(?:nicht-?|ver)?rauch(?!fang|bier|fleisch|wurst|speck|lachs)\w*|zigarette\w*|zigarren erlaubt|\bqualm\w*|nikotin\w*|\btschick\w*", re.I)

# Vienna plus a margin (SPEC 5.1); some official bars sit just outside the city.
BBOX = (16.15, 48.09, 16.61, 48.35)  # min_lon, min_lat, max_lon, max_lat

# Generic client name, no personal contact details (SPEC 5.4).
USER_AGENT = "seidl-tour-planer/0.1 (private, non-commercial)"

AUSTRIA_PBF_URL = "https://download.geofabrik.de/europe/austria-latest.osm.pbf"
WIENER_LINIEN_GTFS_URL = "http://www.wienerlinien.at/ogd_realtime/doku/ogd/gtfs/gtfs.zip"
# CC BY 4.0, no registration; the portal asks to accept its terms of use (checked 2026-11-03).
OEBB_GTFS_URL = "https://static.web.oebb.at/open-data/soll-fahrplan-gtfs/GTFS_Fahrplan_2026.zip"
DISTRICTS_WFS_URL = (
    "https://data.wien.gv.at/daten/geo?service=WFS&request=GetFeature&version=1.1.0"
    "&typeName=ogdwien:BEZIRKSGRENZEOGD&srsName=EPSG:4326&outputFormat=json"
)

OFFICIAL_CSVS = sorted(OWN.glob("official_*.csv"))


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def download(url: str, dest: Path, force: bool = False) -> Path:
    """Download once and cache (SPEC 5.1)."""
    if dest.exists() and dest.stat().st_size > 0 and not force:
        log(f"cached: {dest.name}")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    log(f"downloading {url}")
    with requests.get(url, headers={"User-Agent": USER_AGENT}, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    tmp.rename(dest)
    return dest


def run(cmd: list[str]) -> None:
    log("$ " + " ".join(cmd))
    subprocess.run(cmd, check=True, stdout=sys.stdout, stderr=sys.stderr)


def normalize_name(s: str) -> str:
    """Lowercase, strip accents and punctuation, for fuzzy name matching."""
    s = s.replace("ß", "ss")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"['’`´]", "", s.lower())  # Wombat's -> wombats
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return s.strip()


def slugify(s: str) -> str:
    return normalize_name(s).replace(" ", "-")


def load_overrides() -> dict[str, dict]:
    path = OWN / "overrides.csv"
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        return {r["bar_id"]: r for r in csv.DictReader(f)}


def apply_overrides(bars: list[dict], overrides: dict[str, dict]) -> list[dict]:
    out = []
    for b in bars:
        o = overrides.get(b["id"])
        if o:
            if o.get("hidden") == "1":
                continue
            if o.get("district"):
                b["district"] = int(o["district"])
            if o.get("venue_type"):
                b["venueType"] = o["venue_type"]
            if o.get("address"):
                b["address"] = o["address"]
            if o.get("maps_query"):
                b["mapsQuery"] = o["maps_query"]
        out.append(b)
    return out
