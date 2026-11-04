"""Merge everything into public/data/ (SPEC 3, 6).

Inputs: data/interim/bars.json, data/interim/opening_hours.json, data/own/tags.csv,
public/data/travel/manifest.json (written by 06_travel_matrix.py).
Outputs: public/data/bars.json, public/data/districts.geojson, public/data/manifest.json.

Tags from OSM (essen, gastgarten, live_musik) and computed ones (lang_offen) are derived
here; tags.csv rows (claude, manual) are applied on top, and value 0 removes a tag.
"""

from __future__ import annotations

import csv
import hashlib
import json
from datetime import datetime

import geopandas as gpd

from common import INTERIM, OWN, PUBLIC_DATA, RAW, log

TAGS = ["essen", "urig", "modern", "preiswert", "gehoben", "gastgarten", "lang_offen", "live_musik", "absteige"]
TAGS_HEADER = ["bar_id", "tag", "value", "source", "evidence", "reviewed"]
DAY = 24 * 60


def is_open(weekly: list[list[int]], minute: int) -> bool:
    week = 7 * DAY
    return any(a <= m < b for a, b in weekly for m in (minute, minute + week))


def osm_tags(bar: dict, weekly: list | None) -> set[str]:
    osm = bar.get("osm", {})
    tags = set()
    if osm.get("amenity") == "restaurant" or osm.get("food") == "yes" or osm.get("cuisine"):
        tags.add("essen")
    if osm.get("outdoor_seating", "no") != "no" or osm.get("beer_garden") == "yes" or osm.get("amenity") == "biergarten":
        tags.add("gastgarten")
    if osm.get("live_music") == "yes":
        tags.add("live_musik")
    # Closes at 01:00 or later on Friday or Saturday night: still open at 00:59 on Saturday or Sunday.
    if weekly and (is_open(weekly, 5 * DAY + 59) or is_open(weekly, 6 * DAY + 59)):
        tags.add("lang_offen")
    return tags


def load_tag_rows() -> list[dict]:
    path = OWN / "tags.csv"
    if not path.exists():
        with open(path, "w", newline="", encoding="utf-8") as f:
            csv.writer(f).writerow(TAGS_HEADER)
        return []
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def website(url: str | None) -> str | None:
    if not url:
        return None
    url = url.split(";")[0].strip()
    return url if url.startswith(("http://", "https://")) else "https://" + url


def build_districts(bars: list[dict]) -> None:
    gdf = gpd.read_file(RAW / "districts_wien.geojson")[["BEZNR", "NAMEK", "geometry"]]
    gdf = gdf.rename(columns={"BEZNR": "district", "NAMEK": "name"})
    counts = {d: sum(b["district"] == d for b in bars) for d in range(1, 24)}
    gdf["count"] = gdf["district"].map(counts)
    # Label points inside each district, for the district number on the map.
    labels = gdf.copy()
    labels["geometry"] = gdf.to_crs(31256).geometry.representative_point().to_crs(4326)
    (PUBLIC_DATA / "district_labels.geojson").write_text(labels.to_json(drop_id=True), encoding="utf-8")
    gdf["geometry"] = gdf.geometry.simplify(0.00008, preserve_topology=True)
    gj = json.loads(gdf.to_json(drop_id=True))
    for feat in gj["features"]:  # 5 decimals is about 1 m
        feat["geometry"] = json.loads(json.dumps(feat["geometry"]), parse_float=lambda x: round(float(x), 5))
    (PUBLIC_DATA / "districts.geojson").write_text(json.dumps(gj, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    src = json.loads((INTERIM / "bars.json").read_text(encoding="utf-8"))
    hours = json.loads((INTERIM / "opening_hours.json").read_text(encoding="utf-8"))
    travel = json.loads((PUBLIC_DATA / "travel" / "manifest.json").read_text(encoding="utf-8"))
    index = {bar_id: i for i, bar_id in enumerate(travel["order"])}

    rows = load_tag_rows()
    by_bar: dict[str, list[dict]] = {}
    for r in rows:
        by_bar.setdefault(r["bar_id"], []).append(r)

    bars = []
    for b in src["bars"]:
        if b["id"] not in index:
            raise SystemExit(f"{b['name']} ({b['id']}) has no matrix index; re-run 06_travel_matrix.py")
        weekly = hours.get(b["id"], {}).get("weeklyOpen")
        tags = osm_tags(b, weekly)
        unreviewed = set()
        for r in by_bar.get(b["id"], []):  # later rows win
            if r["tag"] not in TAGS:
                continue
            if r["value"] == "1":
                tags.add(r["tag"])
                if r["reviewed"] != "1":
                    unreviewed.add(r["tag"])
                else:
                    unreviewed.discard(r["tag"])
            else:
                tags.discard(r["tag"])
                unreviewed.discard(r["tag"])
        bars.append({
            "id": b["id"],
            "matrixIndex": index[b["id"]],
            "name": b["name"],
            "district": b["district"],
            "lat": round(b["lat"], 6),
            "lon": round(b["lon"], 6),
            "venueType": b["venueType"],
            **{k: v for k, v in {
                "address": b.get("address"),
                "website": website(b.get("website")),
                "phone": b.get("phone"),
                "wheelchair": b.get("wheelchair"),
                "openingHoursText": b.get("openingHoursText"),
            }.items() if v},
            "weeklyOpen": weekly,
            "official": b["official"],
            # Public tip sources only; the owner's own lists stay private.
            **({"tips": tips} if (tips := [{"source": t["source"], "url": t["url"], **({"kind": t["kind"]} if t.get("kind") else {})}
                                          for t in b.get("tips", [])
                                          if t["source"] != "owner" and t["url"]]) else {}),
            "tags": [t for t in TAGS if t in tags],
            "unreviewedTags": [t for t in TAGS if t in unreviewed],
        })
    bars.sort(key=lambda b: b["matrixIndex"])

    PUBLIC_DATA.mkdir(parents=True, exist_ok=True)
    bars_json = json.dumps(bars, ensure_ascii=False, separators=(",", ":"))
    (PUBLIC_DATA / "bars.json").write_text(bars_json, encoding="utf-8")
    build_districts(bars)

    h = hashlib.sha256(bars_json.encode())
    for name in ["walk", "transit_p50"]:
        h.update((PUBLIC_DATA / "travel" / f"{name}.bin").read_bytes())
    editions = sorted({e for b in bars for e in b["official"]})
    manifest = {
        "dataVersion": h.hexdigest()[:12],
        "generated": datetime.now().isoformat(timespec="seconds"),
        "n": len(bars),
        "order": travel["order"],
        "travel": {k: travel[k] for k in ["departure", "window_hours", "speed_walking_kmh", "feeds"]},
        "osmTimestamp": src["stats"]["osm_timestamp"],
        "newestOfficialEdition": editions[-1] if editions else None,
    }
    (PUBLIC_DATA / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    counts = {t: sum(t in b["tags"] for b in bars) for t in TAGS}
    log(f"wrote {len(bars)} bars ({len(bars_json) // 1024} KB), tags {counts}, dataVersion {manifest['dataVersion']}")


if __name__ == "__main__":
    main()
