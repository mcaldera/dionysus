"""OSM to candidate bars: query, classify, drop, deduplicate, assign districts (SPEC 5.2).

Writes data/interim/bars_import.json. Official bars are added by 03_match_official.py.
"""

from __future__ import annotations

import json
import re
import time

import geopandas as gpd
import requests
from rapidfuzz import fuzz
from shapely.geometry import Point

import csv

from common import INTERIM, OWN, RAW, USER_AGENT, apply_overrides, load_overrides, log, normalize_name

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_CACHE = RAW / "overpass_bars.json"
QUERY = """[out:json][timeout:180];
area["name"="Wien"]["admin_level"="4"]->.wien;
(
  nwr["amenity"~"^(pub|bar|biergarten|restaurant|cafe)$"](area.wien);
  nwr["leisure"="bowling_alley"](area.wien);
);
out center tags;
"""

DEDUPE_M = 30


def fetch() -> list[dict]:
    """Query Overpass once and cache the result (SPEC 5.2)."""
    if not OVERPASS_CACHE.exists():
        for attempt in range(4):
            log(f"querying Overpass (attempt {attempt + 1})")
            r = requests.post(OVERPASS_URL, data={"data": QUERY}, headers={"User-Agent": USER_AGENT}, timeout=300)
            if r.ok:
                OVERPASS_CACHE.write_bytes(r.content)
                break
            log(f"Overpass returned {r.status_code}; waiting")
            time.sleep(30)
        else:
            raise SystemExit("Overpass unavailable")
    data = json.loads(OVERPASS_CACHE.read_text())
    log(f"Overpass data as of {data['osm3s']['timestamp_osm_base']}: {len(data['elements'])} elements")
    return data["elements"]


# Classification (SPEC 5.2 as changed by the owner on 2026-11-03): this is about places to
# drink a Seidl. Bars, Tschocherl, Beisln, Wirtshäuser and Heurigen are in; Kaffeehäuser,
# Konditoreien, bakery and specialty-coffee cafés and foreign-cuisine restaurants are out.

AUSTRIAN_CUISINES = {"austrian", "regional", "viennese", "local", "wiener", "traditional", "styrian", "tyrolean",
                     "schnitzel", "heuriger", "buschenschank", "beer", "wine", "sausage", "grill", "barbecue",
                     "german", "bavarian", "czech", "international", "european", "snack", "bistro"}
COFFEE_CUISINES = {"coffee_shop", "coffee", "cake", "pastry", "breakfast", "brunch", "bagel", "sandwich", "crepe",
                   "ice_cream", "bubble_tea", "frozen_yogurt", "juice", "donut", "tea", "waffle"}

WIRTSHAUS_NAME = re.compile(
    r"gasthaus|gasthof|beisl|beisel|wirtshaus|st(ü|ue)berl|br(ä|ae)u\b|bräu|weinhaus|wirtschaft|\bwirt\b|-wirt\b"
    r"|schenke|brauhaus|bierhaus|stadl|schutzhaus|einkehr|krug", re.I)
HEURIGER = re.compile(r"heurig|buschensch", re.I)
# Words in a name that say "drinking place" (Tschocherl, café-bar, pub).
DRINK_NAME = re.compile(
    r"espresso|caf[eé][- ]?bar|\bbar\b|\bpub\b|beisl|st(ü|ue)berl|stub'?n|tschocherl|schank|kistl|\beck\b|eckerl|treff"
    r"|lik[öo]r|bierstub|weinstub|kneipe|tränke|branntwein|durst|plausch|tschecherl|dart", re.I)
PUB_NAME = re.compile(r"\bpub\b|\bbar\b", re.I)
CAFE_NAME = re.compile(r"^\s*(caf[eé]|kaffee|espresso)\b", re.I)
COFFEE_NAME = re.compile(
    r"konditor|conditor|confiser|zuckerb[äa]ck|p[aâ]tisser|b[äa]ckerei|backstube|bakery|\bbrot\b|bagel|gelat|eissalon"
    r"|\beis\b|frozen|bubble|teehaus|\btea\b|r[öo]st|roast|coffee|specialty|kaffeehaus|kaffeerösterei|mehlspeis|torte|crêpe|crepe"
    r"|brunch|frühstück|waffel|donut|bakehouse|patisserie|chocolat|pfarr|backshop|backhaus|imbiss|naschen"
    r"|kaffee(?!bar)|shisha|hookah|nargile|bubble", re.I)
FOREIGN_NAME = re.compile(
    r"pizz|sushi|kebab|kebap|d[öo]ner|\bwok\b|ramen|trattoria|ristorante|osteria|\basia|thai|india|curry|burger|noodle"
    r"|dumpling|taco|falafel|shawarma|poke|bao\b|pho\b|china|chinese|japan|korea|mexic|greek|griech|tapas", re.I)
FOREIGN_FIRST = {"pizza", "italian", "asian", "chinese", "japanese", "sushi", "indian", "vietnamese", "thai", "turkish",
                 "greek", "mexican", "korean", "kebab", "ramen", "burger", "italian_pizza", "noodle", "persian", "syrian",
                 "fine_dining", "seafood", "fish", "spanish", "french", "lebanese", "arab", "american", "chicken",
                 "pasta", "dumpling", "poke", "hawaiian", "nepalese", "georgian", "ethiopian", "african", "oriental"}

# Coffee chains, bakery cafés and betting-shop cafés, by brand tag or name.
CHAINS = {
    "aida", "starbucks", "kurkonditorei oberlaa", "oberlaa", "segafredo", "tchibo", "wild bean cafe",
    "anker", "der mann", "coffeeshop company", "teeamo", "mccafe", "strock", "julius meinl",
    "joseph brot", "elou", "ichiban tea", "felber", "haubis", "admiral sportwetten", "tipp3", "mcdonalds",
    "gragger", "paremi", "kaffeefabrik", "jonas reindl", "coffee pirates", "balthasar", "tauber", "sluka",
    "demel", "gerstner", "heiner", "diglas", "landtmann", "sacher", "hummel", "fladerei", "do co",
}

# Words on a website: drinking place vs. coffee and cake place vs. Wirtshaus.
DRINK_WORDS = re.compile(
    r"\bbier|\bfass\b|vom fass|gezapft|zapf|seidl|krügerl|pfiff|zipfer|ottakringer|stiegl|gösser|puntigamer|schremser"
    r"|hirter|budweiser|\bpils|spritzer|g'spritzt|schnaps|darts?\b|wuzzler|tischfußball|billard|flipper|\bsky\b"
    r"|fußball|stammtisch|stammgäste|cocktail|longdrink|happy hour|\bbar\b|beisl|karaoke|live.?musik|konzert"
    r"|bis \d+ uhr früh|tschocherl|kneipe", re.I)
COFFEE_WORDS = re.compile(
    r"torte|kuchen|mehlspeis|konditor|patisser|bäckerei|gebäck|croissant|barista|specialty|röst|filterkaffee"
    r"|latte|matcha|frühstück|brunch|\beis\b|gelato|pralinen|kekse|kaffeespezialit|kaffeehaus|zuckerbäck"
    r"|confiserie|backwaren|\bbrot\b|sauerteig", re.I)
WIRTSHAUS_WORDS = re.compile(
    r"wirtshaus|gasthaus|beisl|hausmannskost|wiener küche|schnitzel|gulasch|tafelspitz|backhendl|schweinsbraten"
    r"|bier vom fass|schanigarten|mittagsmenü|stammtisch", re.I)

TIME_RANGE = re.compile(r"(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})(\+?)")


def cuisines_of(tags: dict) -> list[str]:
    return [c.strip().lower() for c in tags.get("cuisine", "").split(";") if c.strip()]


def hours_profile(hours: str | None) -> str | None:
    """'night': open past 01:00 or open-ended on some day; 'late': past 23:00;
    'daytime': always closed by 21:00; None: unknown or in between."""
    if not hours:
        return None
    if re.search(r"\d\+", hours):
        return "night"
    ranges = TIME_RANGE.findall(hours)
    if not ranges:
        return None
    ends = []
    for h1, m1, h2, m2, plus in ranges:
        start, end = int(h1) * 60 + int(m1), int(h2) * 60 + int(m2)
        if plus or (end <= start and end >= 60):
            return "night"
        ends.append(24 * 60 if end <= start else end)
    if max(ends) >= 23 * 60:
        return "late"
    return "daytime" if max(ends) <= 21 * 60 else None


def website_signals(text: str | None) -> tuple[int, int, int]:
    """Distinct drinking, coffee/cake and Wirtshaus words on the website."""
    if not text:
        return 0, 0, 0
    t = text.lower()
    return (len({m.lower() for m in DRINK_WORDS.findall(t)}), len({m.lower() for m in COFFEE_WORDS.findall(t)}),
            len({m.lower() for m in WIRTSHAUS_WORDS.findall(t)}))


def is_chain(tags: dict) -> bool:
    brand = normalize_name(tags.get("brand", ""))
    name = normalize_name(tags["name"])
    return brand in CHAINS or name in CHAINS or any(name.startswith(c + " ") for c in CHAINS)


def fallback_type(tags: dict) -> str:
    """A type for official partner bars the rules above drop (cafés, restaurants, sports venues)."""
    if tags.get("amenity") == "cafe":
        return "tschocherl"
    if tags.get("amenity") == "restaurant":
        return "beisl_wirtshaus"
    return "pub_bar"


def classify(tags: dict, web: str | None) -> tuple[str | None, str]:
    """(venue type, reason). Venue type None means dropped, with the reason why."""
    name = tags.get("name", "")
    if not name:
        return None, "no name"
    if any(k.startswith(("disused:", "abandoned:")) for k in tags):
        return None, "disused or abandoned"
    if is_chain(tags):
        return None, "chain"
    amenity = tags.get("amenity", "")
    cuisines = cuisines_of(tags)
    first = cuisines[0] if cuisines else ""
    drink_name = bool(DRINK_NAME.search(name))
    hours = hours_profile(tags.get("opening_hours"))
    d, c, w = website_signals(web)

    if HEURIGER.search(name) or {"heuriger", "buschenschank"} & set(cuisines):
        return "heuriger", "Heuriger"
    if tags.get("leisure") == "bowling_alley":
        return "pub_bar", "bowling"
    if COFFEE_NAME.search(name) and not drink_name:
        return None, "Kaffeehaus, Konditorei or bakery (name)"
    if tags.get("shop") in {"bakery", "pastry", "confectionery", "coffee", "tea", "ice_cream", "chocolate"}:
        return None, "Kaffeehaus, Konditorei or bakery (shop tag)"

    if amenity in {"pub", "bar", "biergarten"}:
        if CAFE_NAME.search(name):
            return "tschocherl", "bar named Café or Espresso"
        return "pub_bar", "pub or bar"

    if amenity == "cafe":
        if first in COFFEE_CUISINES and not drink_name and hours not in ("late", "night"):
            return None, "café: coffee, cake or breakfast place"
        if first in FOREIGN_FIRST or (FOREIGN_NAME.search(name) and not drink_name):
            return None, "café with foreign cuisine"
        if drink_name:
            return "tschocherl", "café with a drinking name"
        if web is not None and c > d + 1:
            return None, "café: website is about coffee and cake"
        if hours in ("late", "night") or (web is not None and d >= 2 and d >= c):
            return "tschocherl", "café: late hours or drinks on website"
        if hours == "daytime":
            return None, "café: daytime only"
        if web is not None and c > d:
            return None, "café: website leans to coffee and cake"
        # Small cafés without data are more often Tschocherl than Kaffeehäuser (owner, 2026-11-03).
        return "tschocherl", "café without data, assumed Tschocherl"

    if amenity == "restaurant":
        if PUB_NAME.search(name):
            return "pub_bar", "restaurant named Pub or Bar"
        if first in FOREIGN_FIRST or (FOREIGN_NAME.search(name) and not WIRTSHAUS_NAME.search(name)):
            return None, "restaurant with foreign cuisine"
        if first in AUSTRIAN_CUISINES - {"international", "european", "snack", "bistro"} or WIRTSHAUS_NAME.search(name) \
                or drink_name:
            return "beisl_wirtshaus", "Austrian restaurant"
        if hours == "night":
            return "beisl_wirtshaus", "untagged restaurant open past midnight"
        if web is not None and (w >= 2 or (d >= 3 and w >= 1)):
            return "beisl_wirtshaus", "untagged restaurant, Wirtshaus website"
        return None, "other restaurant"
    return None, "other"


def website_text(bar_id: str) -> str | None:
    path = OWN / "website_text" / (bar_id.replace(":", "_").replace("/", "_") + ".txt")
    return path.read_text(encoding="utf-8") if path.exists() else None


def official_osm_ids() -> set[str]:
    """Official bars are never filtered out (SPEC 5.2: 'unless they're on an official list')."""
    path = INTERIM / "official_points.csv"
    if not path.exists():
        return set()
    with open(path, encoding="utf-8") as f:
        return {r["osm_id"] for r in csv.DictReader(f) if r["osm_id"]}


def address(tags: dict) -> str | None:
    street = tags.get("addr:street") or tags.get("addr:place")
    if not street:
        return None
    parts = [f"{street} {tags.get('addr:housenumber', '')}".strip()]
    if tags.get("addr:postcode"):
        parts.append(f"{tags['addr:postcode']} {tags.get('addr:city', 'Wien')}")
    return ", ".join(parts)


def to_bar(el: dict, venue_type: str) -> dict:
    t = el["tags"]
    lat = el.get("lat") or el["center"]["lat"]
    lon = el.get("lon") or el["center"]["lon"]
    return {
        "id": f"osm:{el['type']}/{el['id']}",
        "name": t["name"],
        "lat": lat,
        "lon": lon,
        "venueType": venue_type,
        "address": address(t),
        "website": t.get("website") or t.get("contact:website") or t.get("url"),
        "phone": t.get("phone") or t.get("contact:phone"),
        "wheelchair": t.get("wheelchair"),
        "openingHoursText": t.get("opening_hours"),
        "official": [],
        # Evidence for tagging (SPEC 5.5), not published as such.
        "osm": {k: t[k] for k in ["amenity", "leisure", "cuisine", "food", "outdoor_seating", "beer_garden",
                                  "live_music", "brand", "diet:vegetarian"] if k in t},
    }


def deduplicate(bars: list[dict]) -> tuple[list[dict], list[tuple[dict, dict]]]:
    """Merge entries with similar names less than 30 m apart; keep the one with more data."""
    gdf = gpd.GeoDataFrame(bars, geometry=[Point(b["lon"], b["lat"]) for b in bars], crs=4326).to_crs(31256)
    sindex = gdf.sindex
    richness = [sum(v is not None for v in b.values()) + len(b["osm"]) for b in bars]
    removed: set[int] = set()
    pairs = []
    for i, geom in enumerate(gdf.geometry):
        if i in removed:
            continue
        for j in sindex.query(geom.buffer(DEDUPE_M)):
            if j <= i or j in removed or geom.distance(gdf.geometry.iloc[j]) > DEDUPE_M:
                continue
            a, b = normalize_name(bars[i]["name"]), normalize_name(bars[j]["name"])
            if fuzz.ratio(a, b) >= 85 or (min(len(a), len(b)) >= 5 and (a in b or b in a)):
                keep, drop = (i, j) if richness[i] >= richness[j] else (j, i)
                removed.add(drop)
                pairs.append((bars[keep], bars[drop]))
                if drop == i:
                    break
    return [b for k, b in enumerate(bars) if k not in removed], pairs


def assign_districts(bars: list[dict]) -> list[dict]:
    districts = gpd.read_file(RAW / "districts_wien.geojson")[["BEZNR", "geometry"]].to_crs(31256)
    pts = gpd.GeoDataFrame(geometry=[Point(b["lon"], b["lat"]) for b in bars], crs=4326).to_crs(31256)
    joined = gpd.sjoin_nearest(pts, districts, how="left", max_distance=50, distance_col="dist")
    joined = joined[~joined.index.duplicated()]
    out = []
    for b, (_, row) in zip(bars, joined.iterrows()):
        if row["BEZNR"] == row["BEZNR"]:  # not NaN
            b["district"] = int(row["BEZNR"])
            out.append(b)
    return out


def main() -> None:
    elements = fetch()
    protected = official_osm_ids()
    bars, dropped, kept_why = [], {}, {}
    for el in elements:
        t = el.get("tags", {})
        bar_id = f"osm:{el['type']}/{el['id']}"
        vt, reason = classify(t, website_text(bar_id))
        if vt is None and bar_id in protected and t.get("name"):
            vt, reason = fallback_type(t), "official list"
        if vt is None:
            dropped[reason] = dropped.get(reason, 0) + 1
            continue
        kept_why[reason] = kept_why.get(reason, 0) + 1
        bar = to_bar(el, vt)
        bar["why"] = reason
        bars.append(bar)
    log(f"kept {len(bars)}, dropped {dropped}")

    bars, dupes = deduplicate(bars)
    log(f"{len(dupes)} duplicates merged")
    n_before = len(bars)
    bars = assign_districts(bars)
    log(f"{n_before - len(bars)} outside the district polygons")
    bars = apply_overrides(bars, load_overrides())

    INTERIM.mkdir(parents=True, exist_ok=True)
    stats = {"elements": len(elements), "dropped": dropped, "kept": kept_why, "duplicates": len(dupes),
             "outside": n_before - len(bars), "total": len(bars),
             "osm_timestamp": json.loads(OVERPASS_CACHE.read_text())["osm3s"]["timestamp_osm_base"],
             "duplicate_examples": [[k["name"], d["name"]] for k, d in dupes[:15]]}
    (INTERIM / "bars_import.json").write_text(json.dumps({"stats": stats, "bars": bars}, ensure_ascii=False, indent=1),
                                              encoding="utf-8")
    log(f"wrote bars_import.json with {len(bars)} bars")


if __name__ == "__main__":
    main()
