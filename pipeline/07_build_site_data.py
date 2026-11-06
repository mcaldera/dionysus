"""Merge everything into public/data/ (SPEC 3, 6).

Inputs: data/interim/bars.json, data/interim/opening_hours.json, data/own/tags.csv,
data/own/google_place_ids.csv, data/own/google_scores.csv and data/own/bar_profiles.json
and data/own/atlas.json (optional), public/data/travel/manifest.json (written by 06_travel_matrix.py).
Outputs: public/data/bars.json, public/data/atlas.json, public/data/districts.geojson, public/data/vienna_mask.geojson,
public/data/manifest.json.

Tags from OSM (essen, gastgarten, live_musik) and computed ones (lang_offen) are derived
here, and so are score tags (beliebt, top_bewertet, geheimtipp, polarisiert) from
data/own/google_scores.csv; profile tags (data/own/bar_profiles.json, from a local LLM) are
added as unreviewed;
tags.csv rows (claude, manual) are applied on top, and value 0 removes a tag.
"""

from __future__ import annotations

import csv
import hashlib
import json
from datetime import datetime

import geopandas as gpd
from shapely.geometry import box, mapping

from common import INTERIM, OWN, PUBLIC_DATA, RAW, load_overrides, log

VENUE_TYPES = ["pub_bar", "tschocherl", "beisl_wirtshaus", "heuriger"]
TAGS = ["essen", "urig", "modern", "preiswert", "gehoben", "gastgarten", "lang_offen", "live_musik", "absteige",
        "cocktails", "wein", "studenten", "fussball", "dart", "billard", "spiele", "karaoke", "tanzen",
        "beliebt", "top_bewertet", "geheimtipp", "polarisiert"]
# Tags from the 0-100 Google-review scores (google_scores.csv): score name and the threshold.
# beliebt = "sehr bekannt" (top 30%), top_bewertet = about 4.7 stars and up, geheimtipp and
# polarisiert = the badges (about the top 6% and 3%).
SCORE_TAGS = {"beliebt": ("popularity", 70), "top_bewertet": ("satisfaction", 85),
              "geheimtipp": ("geheimtipp", 80), "polarisiert": ("polarizing", 50)}
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


def load_place_ids() -> dict[str, str]:
    # Google place ids, only for a precise "In Google Maps ansehen" link.
    path = OWN / "google_place_ids.csv"
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        return {r["bar_id"]: r["place_id"] for r in csv.DictReader(f)}


def load_scores() -> dict[str, dict[str, int]]:
    # 0-100 scores derived from Google reviews (popularity, satisfaction, geheimtipp, polarizing);
    # Google's own numbers (stars, review counts) are not published.
    path = OWN / "google_scores.csv"
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        return {r.pop("bar_id"): {k: int(v) for k, v in r.items()} for r in csv.DictReader(f)}


def load_profiles() -> dict[str, dict]:
    # Description, keywords, tags, similar bars and scatterplot position per bar (pipeline/private/similarity.py).
    path = OWN / "bar_profiles.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def write_atlas(published: dict[str, int]) -> None:
    """data/own/atlas.json (pipeline/private/similarity.py) -> public/data/atlas.json, bars as matrix
    indices and only those still published."""
    src = OWN / "atlas.json"
    out = PUBLIC_DATA / "atlas.json"
    if not src.exists():
        out.unlink(missing_ok=True)
        return
    a = json.loads(src.read_text(encoding="utf-8"))
    keep = [i for i, bar_id in enumerate(a["ids"]) if bar_id in published]
    pick = lambda xs: [xs[i] for i in keep]  # noqa: E731
    atlas = {
        "bars": [published[a["ids"][i]] for i in keep],
        "layouts": {k: pick(v) for k, v in a["layouts"].items()},
        "levels": [{**lv, "assign": pick(lv["assign"])} for lv in a["levels"]],
        "facets": {**a["facets"], "values": pick(a["facets"]["values"])},
    }
    out.write_text(json.dumps(atlas, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


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
    # Everything outside Vienna, for a grey wash on the map: a large box minus the city. A tiny
    # buffer closes the slivers between the simplified district outlines.
    city = gdf.geometry.buffer(0.00002).union_all()
    mask = box(14.0, 47.0, 18.8, 49.6).difference(city)
    mask_gj = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {},
                                                          "geometry": json.loads(json.dumps(mapping(mask)), parse_float=lambda x: round(float(x), 5))}]}
    (PUBLIC_DATA / "vienna_mask.geojson").write_text(json.dumps(mask_gj, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    src = json.loads((INTERIM / "bars.json").read_text(encoding="utf-8"))
    hours = json.loads((INTERIM / "opening_hours.json").read_text(encoding="utf-8"))
    travel = json.loads((PUBLIC_DATA / "travel" / "manifest.json").read_text(encoding="utf-8"))
    index = {bar_id: i for i, bar_id in enumerate(travel["order"])}

    overrides = load_overrides()
    place_ids = load_place_ids()
    scores = load_scores()
    profiles = load_profiles()
    rows = load_tag_rows()
    by_bar: dict[str, list[dict]] = {}
    for r in rows:
        by_bar.setdefault(r["bar_id"], []).append(r)

    bars = []
    for b in src["bars"]:
        o = overrides.get(b["id"], {})
        if o.get("hidden") == "1":
            continue
        if o.get("address"):
            b["address"] = o["address"]
        if o.get("venue_type"):
            b["venueType"] = o["venue_type"]
        if b["venueType"] not in VENUE_TYPES:
            raise SystemExit(f"{b['name']} ({b['id']}) has venue type {b['venueType']!r}; set venue_type in overrides.csv")
        if b["id"] not in index:
            raise SystemExit(f"{b['name']} ({b['id']}) has no matrix index; re-run 06_travel_matrix.py")
        weekly = hours.get(b["id"], {}).get("weeklyOpen")
        tags = osm_tags(b, weekly)
        unreviewed = set()
        sc = scores.get(b["id"], {})
        tags |= {t for t, (k, minimum) in SCORE_TAGS.items() if sc.get(k, -1) >= minimum}
        prof = profiles.get(b["id"], {})
        for t in prof.get("profileTags", []):
            if t in TAGS and t not in tags:
                tags.add(t)
                unreviewed.add(t)
        for r in by_bar.get(b["id"], []):  # later rows win
            if r["tag"] not in TAGS or r["tag"] in SCORE_TAGS:
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
                "mapsQuery": overrides.get(b["id"], {}).get("maps_query"),
                "placeId": place_ids.get(b["id"]),
                "website": website(b.get("website")),
                "phone": b.get("phone"),
                "wheelchair": b.get("wheelchair"),
                "openingHoursText": b.get("openingHoursText"),
            }.items() if v},
            **scores.get(b["id"], {}),
            **({k: prof[k] for k in ("description", "keywords") if prof.get(k)}),
            **({"profile": {"vec": prof["vec"], "similar": prof["similar"]}} if prof else {}),
            "weeklyOpen": weekly,
            "official": b["official"],
            # Public tip sources only; the owner's own lists stay private.
            **({"tips": tips} if (tips := [{"source": t["source"], "url": t["url"],
                                           **{k: t[k] for k in ("kind", "strength") if t.get(k)},
                                           **({"threads": int(t["threads"])} if t.get("threads") else {})}
                                          for t in b.get("tips", [])
                                          if t["source"] != "owner" and t["url"]]) else {}),
            "tags": [t for t in TAGS if t in tags],
            "unreviewedTags": [t for t in TAGS if t in unreviewed],
        })
    bars.sort(key=lambda b: b["matrixIndex"])
    published = {b["id"]: b["matrixIndex"] for b in bars}
    for b in bars:
        if "profile" in b:
            b["profile"]["similar"] = [published[i] for i in b["profile"]["similar"] if i in published]
    write_atlas(published)

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
        # The matrix size, not the bar count: hidden bars keep their rows, so indices have gaps.
        "n": len(travel["order"]),
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
