"""Fill missing bar addresses from their coordinates (Nominatim reverse geocoding).

Input/output: data/interim/bars.json (written by 03_match_official.py), updated in place.
Many OSM bars are mapped as a bare point without addr:* tags, so the Google Maps link could only
search by name. The address of the nearest building is close, but can be the neighbouring house,
so these bars get `addressSource: "nominatim"`. Results are cached (at most one request per
second); rerun this script after 03_match_official.py and before 07_build_site_data.py.
"""

from __future__ import annotations

import json
import time

import requests

from common import INTERIM, RAW, USER_AGENT, log

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
CACHE = RAW / "nominatim_reverse_cache.json"


class Reverse:
    def __init__(self) -> None:
        self.cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
        self.last = 0.0
        self.fresh = 0

    def lookup(self, lat: float, lon: float) -> dict:
        key = f"{lat:.6f},{lon:.6f}"
        if key not in self.cache:
            wait = 1.1 - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            params = {"lat": key.split(",")[0], "lon": key.split(",")[1], "format": "jsonv2", "zoom": "18",
                      "addressdetails": "1"}
            r = requests.get(NOMINATIM_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=30)
            self.last = time.time()
            r.raise_for_status()
            self.cache[key] = r.json().get("address", {})
            self.fresh += 1
            if self.fresh % 25 == 0:
                self.save()
        return self.cache[key]

    def save(self) -> None:
        CACHE.write_text(json.dumps(self.cache, ensure_ascii=False, indent=1), encoding="utf-8")


def format_address(a: dict) -> str | None:
    road = a.get("road") or a.get("pedestrian") or a.get("square")
    if not road:
        return None
    street = f"{road} {a.get('house_number', '')}".strip()
    if a.get("postcode"):
        return f"{street}, {a['postcode']} Wien"
    return street


def main() -> None:
    path = INTERIM / "bars.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    rev = Reverse()
    todo = [b for b in data["bars"] if not b.get("address")]
    log(f"{len(todo)} of {len(data['bars'])} bars without address")
    filled = 0
    for i, b in enumerate(todo, 1):
        addr = format_address(rev.lookup(b["lat"], b["lon"]))
        if addr:
            b["address"] = addr
            b["addressSource"] = "nominatim"
            filled += 1
        if i % 50 == 0:
            log(f"{i}/{len(todo)}")
    rev.save()
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"filled {filled}, still without address {len(todo) - filled}")


if __name__ == "__main__":
    main()
