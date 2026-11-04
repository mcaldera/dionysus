"""Match official-list venues to OSM and give each one coordinates and a district.

Phase 1 scope: the official bars only, as routing test points. Each address is
geocoded with Nominatim (cached, at most one request per second), then snapped to
the nearby named OSM venue whose name matches best. Rows without a confident
match keep the Nominatim coordinates and are listed in reports/official_match.md.

Phase 2 will match against the full bar import instead of all named OSM objects.
"""

from __future__ import annotations

import csv
import json
import math
import re
import time
from dataclasses import dataclass, field

import geopandas as gpd
import requests
from rapidfuzz import fuzz
from shapely.geometry import Point, shape

from common import (
    INTERIM, OFFICIAL_CSVS, OWN, RAW, REPORTS, USER_AGENT, apply_overrides, load_overrides, log,
    normalize_name, run, slugify,
)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_CACHE = RAW / "nominatim_cache.json"
POIS = INTERIM / "named_pois.geojsonseq"

# Words that say what kind of place it is rather than which one.
GENERIC = {
    "restaurant", "gasthaus", "cafe", "caffe", "kaffee", "bar", "pub", "beisl", "wirtshaus",
    "the", "das", "der", "die", "zum", "zur", "am", "im", "wien", "vienna", "and", "und",
    "irish", "british", "cocktailbar", "bierbar", "biergasthof", "weinhaus",
}

# OSM kinds a Seidl could plausibly be served in; others (brothels, gates, shops) rank lower.
DRINK_KINDS = {
    "pub", "bar", "biergarten", "restaurant", "cafe", "fast_food", "nightclub", "food_court",
    "bowling_alley", "sports_centre", "fitness_centre", "hostel", "hotel", "music_venue",
    "arts_centre", "theatre", "events_venue", "deli", "beverages", "alcohol", "brewery", "wine",
}

MATCH_RADIUS_M = 400
OK_DIST_M = 150
OK_SCORE = 80
MIN_SCORE = 60


@dataclass
class Venue:
    key: str
    name: str
    address: str
    postcode: str
    district: int
    website: str
    editions: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def load_official() -> list[Venue]:
    venues: dict[str, Venue] = {}
    for path in OFFICIAL_CSVS:
        with open(path, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                key = slugify(row["name"]) + "|" + normalize_name(row["address"].split(",")[0])
                v = venues.get(key)
                if v is None:
                    v = venues[key] = Venue(key, row["name"], row["address"], row["postcode"],
                                            int(row["district"]), row["website"])
                v.editions.append(row["edition"])
                if row["notes"]:
                    v.notes.append(f'{row["edition"]}: {row["notes"]}')
    return list(venues.values())


def extract_pois() -> gpd.GeoDataFrame:
    if not POIS.exists():
        INTERIM.mkdir(parents=True, exist_ok=True)
        filtered = INTERIM / "named_pois.osm.pbf"
        run(["osmium", "tags-filter", str(RAW / "vienna.osm.pbf"),
             "nwr/amenity", "nwr/leisure", "nwr/shop", "nwr/tourism", "nwr/craft",
             "-o", str(filtered), "--overwrite"])
        run(["osmium", "export", str(filtered), "-f", "geojsonseq", "-a", "type,id",
             "-o", str(POIS), "--overwrite"])
    rows = []
    with open(POIS, encoding="utf-8") as f:
        for line in f:
            feat = json.loads(line.lstrip("\x1e"))
            p = feat["properties"]
            if "name" not in p:
                continue
            geom = shape(feat["geometry"])
            c = geom if geom.geom_type == "Point" else geom.representative_point()
            kind = p.get("amenity") or p.get("leisure") or p.get("shop") or p.get("tourism") or p.get("craft")
            if kind is None:  # way member nodes such as entrances
                continue
            rows.append({"osm_id": f'osm:{p["@type"]}/{p["@id"]}', "osm_name": p["name"],
                         "kind": kind, "postcode": p.get("addr:postcode", ""),
                         "housenumber": housenumber_key(p.get("addr:housenumber", "")), "geometry": c})
    gdf = gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")
    log(f"{len(gdf)} named OSM POIs")
    return gdf


def housenumber_key(s: str) -> str:
    """First house or stall number, lowercased: '975 C' -> '975c', '130-140' -> '130'."""
    m = re.search(r"[A-Za-z]?\d+\s?[A-Za-z]?\b", s)
    return m.group(0).replace(" ", "").lower() if m else ""


def venue_housenumber(address: str) -> str:
    street = re.sub(r"\(.*?\)", "", address.split(",")[0])
    m = re.search(r"(?:stand\s*)?([A-Za-z]?\d+\s?[A-Za-z]?)\b", street, flags=re.I)
    return m.group(1).replace(" ", "").lower() if m else ""


def clean_street(address: str) -> str:
    street = address.split(",")[0]
    street = re.sub(r"\(.*?\)", "", street)
    street = re.sub(r"\s*(/\s*)?(Top|Tür|Stiege)\s+\S+", "", street, flags=re.I)
    street = re.sub(r"(\d+)\s*[-–]\s*\d+", r"\1", street)  # 253-255 -> 253
    street = re.sub(r"(\d+)\s+([A-Za-z])\b", r"\1\2", street)  # 60 A -> 60A
    street = street.replace("Str.", "Straße")
    street = re.sub(r"(\w)straße", r"\1straße", street)
    return street.strip()


class Nominatim:
    def __init__(self) -> None:
        self.cache = json.loads(NOMINATIM_CACHE.read_text()) if NOMINATIM_CACHE.exists() else {}
        self.last = 0.0

    def search(self, **params: str) -> list[dict]:
        params = {**params, "format": "jsonv2", "limit": "3", "countrycodes": "at"}
        key = json.dumps(params, sort_keys=True, ensure_ascii=False)
        if key not in self.cache:
            wait = 1.1 - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            r = requests.get(NOMINATIM_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=30)
            self.last = time.time()
            r.raise_for_status()
            self.cache[key] = r.json()
            NOMINATIM_CACHE.write_text(json.dumps(self.cache, ensure_ascii=False, indent=1))
        return self.cache[key]

    def geocode(self, v: Venue) -> tuple[float, float, str] | None:
        city = "Perchtoldsdorf" if v.postcode == "2380" else "Wien"
        street = clean_street(v.address)
        attempts = [dict(street=street, postalcode=v.postcode, city=city)]
        if "Auersperstraße" in street:  # misprint in the booklet
            attempts.insert(0, dict(street=street.replace("Auersperstraße", "Auerspergstraße"),
                                    postalcode=v.postcode, city=city))
        if street.startswith("Zum "):  # "Zum Riesenradplatz" is "Riesenradplatz" in OSM
            attempts.append(dict(street=street[4:], postalcode=v.postcode, city=city))
        attempts.append(dict(q=f"{v.name}, {v.postcode} {city}"))
        for params in attempts:
            res = self.search(**params)
            if res:
                return float(res[0]["lat"]), float(res[0]["lon"]), res[0].get("display_name", "")
        return None


def name_score(a: str, b: str) -> float:
    def core(s: str) -> str:
        words = [w for w in normalize_name(s).split() if w not in GENERIC]
        return " ".join(words) or normalize_name(s)
    ca, cb = core(a), core(b)
    score = max(fuzz.token_set_ratio(ca, cb), fuzz.ratio(normalize_name(a), normalize_name(b)))
    # "Soft Rock Cafe" vs "s'Eck Softrock": compare without spaces for longer names.
    sa, sb = ca.replace(" ", ""), cb.replace(" ", "")
    if min(len(sa), len(sb)) >= 6 and fuzz.partial_ratio(sa, sb) == 100:
        score = max(score, 90)
    return score


def kind_bonus(kind: str) -> float:
    return 5 if kind in DRINK_KINDS else -20


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def load_districts() -> gpd.GeoDataFrame:
    gdf = gpd.read_file(RAW / "districts_wien.geojson")
    return gdf[["BEZNR", "geometry"]].rename(columns={"BEZNR": "district"})


def district_of(districts: gpd.GeoDataFrame, lat: float, lon: float) -> int | None:
    hit = districts[districts.contains(Point(lon, lat))]
    return int(hit.iloc[0]["district"]) if len(hit) else None


def main() -> None:
    venues = load_official()
    log(f"{len(venues)} distinct official venues from {[p.name for p in OFFICIAL_CSVS]}")
    pois = extract_pois()
    pois_m = pois.to_crs(31256)  # MGI / Austria GK East, metres
    districts = load_districts()
    nom = Nominatim()

    out = []
    for v in venues:
        best = None  # (rank, index, name score, distance in m or nan)
        status_hint = None
        geo = nom.geocode(v)
        glat, glon, display = geo if geo else (None, None, "")

        # A: OSM address tags name the same postcode and house or stall number.
        hn = venue_housenumber(v.address)
        if hn:
            same = pois[(pois["postcode"] == v.postcode) & (pois["housenumber"] == hn)]
            for idx, row in same.iterrows():
                s = name_score(v.name, row["osm_name"])
                if s >= 90 and (best is None or s + kind_bonus(row["kind"]) > best[0]):
                    best = (s + kind_bonus(row["kind"]), idx, s, float("nan"))
            if best is not None:
                status_hint = "matched"

        # B: named venue near the geocoded address.
        if best is None and geo:
            gp = gpd.GeoSeries([Point(glon, glat)], crs=4326).to_crs(31256).iloc[0]
            near = pois_m[pois_m.distance(gp) <= MATCH_RADIUS_M]
            for idx, row in near.iterrows():
                s = name_score(v.name, row["osm_name"])
                d = row.geometry.distance(gp)
                rank = s - d / 20 + kind_bonus(row["kind"])  # 20 m costs one point of name score
                if s >= MIN_SCORE and (best is None or rank > best[0]):
                    best = (rank, idx, s, d)

        # C: no address hit: look for the name inside the listed district.
        if best is None:
            in_district = pois[pois.within(districts.loc[districts["district"] == v.district].union_all())] \
                if v.district in set(districts["district"]) else pois.iloc[0:0]
            for idx, row in in_district.iterrows():
                s = name_score(v.name, row["osm_name"])
                rank = s + kind_bonus(row["kind"])
                if s >= 90 and (best is None or rank > best[0]):
                    best = (rank, idx, s, float("nan"))
            if best is not None and best[2] >= 95 and pois.loc[best[1], "kind"] in DRINK_KINDS:
                status_hint = "matched"

        rec = {"key": v.key, "name": v.name, "address": v.address, "listed_district": v.district,
               "editions": ";".join(v.editions), "website": v.website,
               "geocode_lat": glat, "geocode_lon": glon, "geocode_display": display}
        if best is not None:
            _, idx, s, d = best
            poi = pois.loc[idx]
            confident = (s >= OK_SCORE and d <= OK_DIST_M) or (s >= 95 and d <= 300 and poi["kind"] in DRINK_KINDS)
            status = status_hint or ("matched" if confident else "uncertain")
            rec.update(osm_id=poi["osm_id"], osm_name=poi["osm_name"], osm_kind=poi["kind"],
                       name_score=round(s), dist_m=None if math.isnan(d) else round(d),
                       lat=poi.geometry.y, lon=poi.geometry.x, coord_source="osm", status=status)
        elif geo:
            rec.update(osm_id="", osm_name="", osm_kind="", name_score=None, dist_m=None,
                       lat=glat, lon=glon, coord_source="nominatim", status="unmatched")
        else:
            rec.update(osm_id="", osm_name="", osm_kind="", name_score=None, dist_m=None,
                       lat=None, lon=None, coord_source="", status="no_coordinates")
        rec["pip_district"] = district_of(districts, rec["lat"], rec["lon"]) if rec["lat"] else None
        rec["notes"] = " | ".join(v.notes)
        out.append(rec)
        log(f'{rec["status"]:>10}  {v.district:>2}  {v.name}  ->  {rec["osm_name"] or rec["coord_source"]}'
            f'  (score {rec["name_score"]}, {rec["dist_m"]} m)')

    INTERIM.mkdir(parents=True, exist_ok=True)
    with open(INTERIM / "official_points.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    write_report(out)
    if (INTERIM / "bars_import.json").exists():
        merge_with_import(out, venues)


def official_bar(rec: dict, tags: dict, venue_type: str) -> dict:
    """A bar entry for an official venue the import filtered out (hostel, boulder gym, shop...)."""
    return {
        "id": rec["osm_id"] or f"own:{slugify(rec['name'])}",
        "name": rec["name"],
        "lat": float(rec["lat"]),
        "lon": float(rec["lon"]),
        "venueType": venue_type,
        "address": rec["address"],
        "website": tags.get("website") or tags.get("contact:website") or ("https://" + rec["website"] if rec["website"] else None),
        "phone": tags.get("phone") or tags.get("contact:phone"),
        "wheelchair": tags.get("wheelchair"),
        "openingHoursText": tags.get("opening_hours"),
        "official": [],
        "osm": {k: tags[k] for k in ["amenity", "leisure", "cuisine", "food", "outdoor_seating", "beer_garden",
                                     "live_music", "brand"] if k in tags},
    }


def poi_tags(ids: set[str]) -> dict[str, dict]:
    out = {}
    with open(POIS, encoding="utf-8") as f:
        for line in f:
            p = json.loads(line.lstrip("\x1e"))["properties"]
            key = f'osm:{p["@type"]}/{p["@id"]}'
            if key in ids:
                out[key] = p
    return out


def merge_with_import(out: list[dict], venues: list[Venue]) -> None:
    """Mark official bars in the import; add the ones it doesn't contain (SPEC 5.3)."""
    data = json.loads((INTERIM / "bars_import.json").read_text(encoding="utf-8"))
    bars = data["bars"]
    by_id = {b["id"]: b for b in bars}
    gdf = gpd.GeoDataFrame(geometry=[Point(b["lon"], b["lat"]) for b in bars], crs=4326).to_crs(31256)
    guess = {v.key: v for v in venues}
    with open(OFFICIAL_CSVS[-1], encoding="utf-8") as f:
        guess_type = {slugify(r["name"]): r["venue_type_guess"] for r in csv.DictReader(f)}
    for path in OFFICIAL_CSVS[:-1]:
        with open(path, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                guess_type.setdefault(slugify(r["name"]), r["venue_type_guess"])
    tags = poi_tags({r["osm_id"] for r in out if r["osm_id"]})

    extra_rows, added = [], []
    for rec in out:
        v = guess[rec["key"]]
        bar, how = by_id.get(rec["osm_id"]), "in import"
        if bar is None and rec["lat"]:
            # A different OSM object for the same place, e.g. the bar inside a hotel.
            p = gpd.GeoSeries([Point(float(rec["lon"]), float(rec["lat"]))], crs=4326).to_crs(31256).iloc[0]
            for i in gdf.sindex.query(p.buffer(75)):
                if name_score(v.name, bars[i]["name"]) >= 80:
                    bar, how = bars[i], "in import, nearby object"
                    break
        if bar is None:
            vt = guess_type.get(slugify(v.name), "special")
            if rec["osm_id"]:
                bar, how = official_bar(rec, tags.get(rec["osm_id"], {}), vt), "added from OSM"
            else:
                bar, how = official_bar(rec, {}, vt), "added to extra_bars.csv"
                extra_rows.append({"name": v.name, "district": v.district, "lat": rec["lat"], "lon": rec["lon"],
                                   "type": vt, "note": "Nominatim address point; check by hand"})
            bar["district"] = rec["pip_district"] or v.district
            bars.append(bar)
            added.append(bar)
            by_id[bar["id"]] = bar
        bar["official"] = sorted(set(bar["official"]) | set(v.editions))
        rec["import_status"] = how
        rec["bar_id"] = bar["id"]

    if extra_rows:
        path = OWN / "extra_bars.csv"
        existing = set()
        if path.exists():
            with open(path, encoding="utf-8") as f:
                existing = {r["name"] for r in csv.DictReader(f)}
        new = [r for r in extra_rows if r["name"] not in existing]
        if new:
            write_header = not path.exists()
            with open(path, "a", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=["name", "district", "lat", "lon", "type", "note"])
                if write_header:
                    w.writeheader()
                w.writerows(new)

    # Bars not in OSM (SPEC 5.2: own:<slug>), whether official or added by hand.
    path = OWN / "extra_bars.csv"
    if path.exists():
        with open(path, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                bar_id = f"own:{slugify(row['name'])}"
                if bar_id in by_id:
                    continue
                bar = {"id": bar_id, "name": row["name"], "lat": float(row["lat"]), "lon": float(row["lon"]),
                       "venueType": row["type"], "district": int(row["district"]), "official": [], "osm": {},
                       "address": None, "website": None, "phone": None, "wheelchair": None, "openingHoursText": None}
                bars.append(bar)
                by_id[bar_id] = bar

    tip_report = merge_tips(bars, by_id)

    bars = apply_overrides(bars, load_overrides())
    data["stats"]["tips"] = tip_report
    (INTERIM / "bars.json").write_text(json.dumps({"stats": data["stats"], "bars": bars, "official": out},
                                                  ensure_ascii=False, indent=1), encoding="utf-8")
    counts = {}
    for rec in out:
        counts[rec["import_status"]] = counts.get(rec["import_status"], 0) + 1
    log(f"merged with import: {counts}; {len(bars)} bars in data/interim/bars.json")


TIP_TYPE = {"tschocherl": "tschocherl", "bier": "pub_bar", "beisl": "beisl_wirtshaus", "kultig": "pub_bar"}


def tip_score(tip: str, name: str, no_district: bool) -> float:
    """Name score with the full-name similarity as tie-break ("Cafe Haller" over "Gasthaus Haller").
    Tips without a district need a close full-name match. 0 means no match."""
    sc = name_score(tip, name)
    full = fuzz.ratio(normalize_name(tip), normalize_name(name))
    if sc < 90 or (no_district and full < 85):
        return 0
    return sc + full / 100


def merge_tips(bars: list[dict], by_id: dict[str, dict]) -> list[dict]:
    """Attach data/own/tips.csv to bars; add tipped places the import dropped.

    A tip is matched by name (and district, if given) to a bar, else to any named OSM
    venue in that district. Unmatched tips are reported for a hand check.
    """
    path = OWN / "tips.csv"
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        tips = list(csv.DictReader(f))
    pois = None
    districts = load_districts()
    report = []
    for tip in tips:
        dist = int(tip["district"]) if tip["district"] else None
        best = None
        for b in bars:
            if dist and b["district"] != dist:
                continue
            sc = tip_score(tip["name"], b["name"], dist is None)
            if sc and (best is None or sc > best[0]):
                best = (sc, b)
        how = "matched"
        if best is None:
            if pois is None:
                pois = extract_pois()
                pois = pois[pois["kind"].isin(DRINK_KINDS)]
                pois["district"] = [district_of(districts, g.y, g.x) for g in pois.geometry]
            cand = pois if dist is None else pois[pois["district"] == dist]
            for _, row in cand.iterrows():
                sc = tip_score(tip["name"], row["osm_name"], dist is None)
                if sc and (best is None or sc > best[0]):
                    best = (sc, row)
            if best is not None:
                row = best[1]
                rec = {"osm_id": row["osm_id"], "name": row["osm_name"], "lat": row.geometry.y, "lon": row.geometry.x,
                       "address": None, "website": ""}
                bar = official_bar(rec, poi_tags({row["osm_id"]}).get(row["osm_id"], {}),
                                   TIP_TYPE.get(tip["kind"], "tschocherl"))
                bar["district"] = int(row["district"]) if row["district"] else dist
                if bar["id"] in by_id:
                    bar = by_id[bar["id"]]
                else:
                    bars.append(bar)
                    by_id[bar["id"]] = bar
                best = (best[0], bar)
                how = "added from OSM"
        if best is None:
            report.append({**tip, "status": "not found"})
            continue
        bar = best[1]
        bar.setdefault("tips", [])
        if not any(t["source"] == tip["source"] for t in bar["tips"]):
            bar["tips"].append({"source": tip["source"], "kind": tip["kind"], "url": tip["url"]})
        report.append({**tip, "status": how, "bar": bar["name"], "bar_id": bar["id"]})
    counts: dict[str, int] = {}
    for r in report:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    log(f"tips: {counts}")
    return report


def write_report(out: list[dict]) -> None:
    def md(s) -> str:
        return "" if s is None else str(s).replace("|", "\\|")

    counts = {k: sum(1 for r in out if r["status"] == k)
              for k in ["matched", "uncertain", "unmatched", "no_coordinates"]}
    lines = [
        "# Official bars: matching and coordinates",
        "",
        f"{len(out)} distinct venues across {', '.join(p.stem for p in OFFICIAL_CSVS)}.",
        "",
        "| Status | Count |", "|---|---|",
        *[f"| {k} | {v} |" for k, v in counts.items()],
        "",
        "`matched`: OSM venue within 150 m of the geocoded address with name score ≥ 80. "
        "`uncertain`: weaker name or distance; coordinates taken from OSM anyway. "
        "`unmatched`: Nominatim address coordinates only. These go to `extra_bars.csv` after a hand check in Phase 2.",
        "",
        "## Needs a look",
        "",
        "| Bezirk | Name | Status | OSM name | Score | Distance | Note |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in out:
        note = []
        if r["pip_district"] != r["listed_district"]:
            note.append(f'point is in district {r["pip_district"]}')
        if r["status"] != "matched" or note:
            lines.append(f'| {r["listed_district"]} | {md(r["name"])} | {r["status"]} | {md(r["osm_name"])} '
                         f'| {md(r["name_score"])} | {md(r["dist_m"])} | {md("; ".join(note))} |')
    lines += ["", "## All venues", "",
              "| Bezirk | Name | Editions | OSM | Coordinates | District by polygon |",
              "|---|---|---|---|---|---|"]
    for r in sorted(out, key=lambda r: (r["listed_district"], r["name"])):
        coord = f'{r["lat"]:.5f}, {r["lon"]:.5f}' if r["lat"] else ""
        lines.append(f'| {r["listed_district"]} | {md(r["name"])} | {r["editions"]} | {md(r["osm_id"])} '
                     f'| {coord} | {md(r["pip_district"])} |')
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "official_match.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    log(f"wrote reports/official_match.md: {counts}")


if __name__ == "__main__":
    main()
