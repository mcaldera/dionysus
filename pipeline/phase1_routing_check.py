"""Write reports/routing_check.md for the Phase 1 gate.

Picks 20 sample legs between official bars (short, long, cross-Danube and
outer districts) for the owner to compare with WienMobil or Google by hand.
Re-running keeps the owner's entries in the "WienMobil" column of an existing
report and computes the median difference once at least one is filled in.
"""

from __future__ import annotations

import csv
import json
import math
import random
import re
import statistics
import sys
import zipfile
from pathlib import Path
from urllib.parse import quote

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from common import INTERIM, RAW, REPORTS  # noqa: E402

PHASE1 = INTERIM / "phase1"
NO_SBAHN = INTERIM / "phase1_no_sbahn"
TOLERANCE = 5  # SPEC 2: walk if at most 5 minutes slower
UNREACHABLE = 255
NORTH_OF_DANUBE = {21, 22}
OUTER = {10, 11, 12, 13, 14, 16, 17, 18, 19, 23}
REPORT = REPORTS / "routing_check.md"


def load(dirpath: Path) -> tuple[dict, dict[str, np.ndarray]]:
    manifest = json.loads((dirpath / "manifest.json").read_text())
    n = manifest["n"]
    mats = {name: np.frombuffer((dirpath / f"{name}.bin").read_bytes(), dtype=np.uint8).reshape(n, n)
            for name in ["walk", "transit_p25", "transit_p50", "transit_p75"]}
    return manifest, mats


def km(a: dict, b: dict) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, [float(a["lat"]), float(a["lon"]), float(b["lat"]), float(b["lon"])])
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def leg(m: dict[str, np.ndarray], u: int, v: int) -> tuple[str, int]:
    w, t = int(m["walk"][u, v]), int(m["transit_p50"][u, v])
    if t == UNREACHABLE or w <= t + TOLERANCE:
        return "zu Fuß", w
    return "Öffis", t


def pick_legs(points: list[dict], m: dict[str, np.ndarray]) -> list[tuple[str, int, int]]:
    rng = random.Random(2026)
    n = len(points)
    d = [int(p["listed_district"]) for p in points]
    pairs = [(u, v) for u in range(n) for v in range(n) if u != v and d[u] != d[v]]
    rng.shuffle(pairs)
    used: dict[int, int] = {}
    chosen: list[tuple[str, int, int]] = []
    seen_pairs: set[frozenset] = set()

    def take(kind: str, candidates, k: int) -> None:
        for u, v in candidates:
            if sum(1 for c in chosen if c[0] == kind) >= k:
                return
            if used.get(u, 0) >= 2 or used.get(v, 0) >= 2 or frozenset((u, v)) in seen_pairs:
                continue
            chosen.append((kind, u, v))
            seen_pairs.add(frozenset((u, v)))
            used[u] = used.get(u, 0) + 1
            used[v] = used.get(v, 0) + 1

    take("kurz", [(u, v) for u, v in pairs if leg(m, u, v)[0] == "zu Fuß" and leg(m, u, v)[1] <= 15], 5)
    longest = sorted(pairs, key=lambda p: -int(m["transit_p50"][p]))
    take("lang", longest[:60], 4)
    take("über die Donau", [(u, v) for u, v in pairs
                            if (d[u] in NORTH_OF_DANUBE) != (d[v] in NORTH_OF_DANUBE)
                            and leg(m, u, v)[0] == "Öffis"], 5)
    take("Außenbezirke", [(u, v) for u, v in pairs
                          if d[u] in OUTER and d[v] in OUTER and leg(m, u, v)[0] == "Öffis"], 6)
    return chosen


def gmaps(a: dict, b: dict, mode: str) -> str:
    travelmode = "walking" if mode == "zu Fuß" else "transit"
    return (f"https://www.google.com/maps/dir/?api=1&origin={float(a['lat']):.6f},{float(a['lon']):.6f}"
            f"&destination={float(b['lat']):.6f},{float(b['lon']):.6f}&travelmode={travelmode}")


def previous_entries() -> dict[str, str]:
    """Owner's WienMobil minutes from an existing report, keyed by leg number."""
    if not REPORT.exists():
        return {}
    out = {}
    for line in REPORT.read_text(encoding="utf-8").splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 10 and cells[0].isdigit():
            out[cells[0]] = cells[8]
    return out


def feed_dates(feed: str) -> str:
    z = zipfile.ZipFile(RAW / feed)
    prefix = next((n.split("/")[0] + "/" for n in z.namelist() if n.endswith("/agency.txt")), "")
    rows = list(csv.DictReader(z.open(prefix + "calendar.txt").read().decode("utf-8-sig").splitlines()))
    s, e = min(r["start_date"] for r in rows), max(r["end_date"] for r in rows)
    return f"{s[:4]}-{s[4:6]}-{s[6:]} to {e[:4]}-{e[4:6]}-{e[6:]}"


def main() -> None:
    with open(INTERIM / "official_points.csv", encoding="utf-8") as f:
        by_key = {r["key"]: r for r in csv.DictReader(f)}
    manifest, m = load(PHASE1)
    points = [by_key[k] for k in manifest["order"]]
    stats = json.loads((PHASE1 / "run_stats.json").read_text())
    no_sbahn = load(NO_SBAHN)[1] if (NO_SBAHN / "manifest.json").exists() else None
    legs = pick_legs(points, m)
    osm = [r for r in by_key.values() if r["coord_source"] == "osm"]
    prev = previous_entries()

    n = manifest["n"]
    off = ~np.eye(n, dtype=bool)
    p50 = m["transit_p50"][off].astype(float)
    lines = [
        "# Routing check (Phase 1 gate)",
        "",
        f"Generated {manifest['generated']} from {n} official bars (April and October 2026 lists combined).",
        "",
        "## How to check",
        "",
        "For each leg below, look up the trip in WienMobil (or Google Maps) for **Saturday 14 November 2026, "
        "leaving at 14:00**. Enter the minutes from 14:00 until arrival (or a range such as 32-46) in the *WienMobil* column, "
        "then re-run `python pipeline/phase1_routing_check.py`. The script works out the differences "
        "and the median.",
        "",
        "- Our transit time is the **median over all departure minutes from 10:00 to 22:00**, including the "
        "wait at the first stop, so it should usually be a few minutes above the best trip a planner shows "
        "for a well-timed departure.",
        "- *Gewählt* applies the walking rule: walk if walking is at most 5 minutes slower than transit.",
        "- *Öffis (meist)* is the 25th–75th percentile across departures.",
        "- **Pass:** the median difference is at most 5 minutes.",
        "",
        "## Sample legs",
        "",
        "| # | Typ | Von | Nach | km | Zu Fuß | Öffis p50 (meist) | Gewählt | WienMobil | Diff | Ohne S-Bahn | Link |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    diffs = []
    for i, (kind, u, v) in enumerate(legs, 1):
        a, b = points[u], points[v]
        mode, minutes = leg(m, u, v)
        walk = "–" if m["walk"][u, v] == UNREACHABLE else f"{m['walk'][u, v]}"
        transit = f"{m['transit_p50'][u, v]} ({m['transit_p25'][u, v]}–{m['transit_p75'][u, v]})"
        entry = prev.get(str(i), "")
        diff = ""
        # A single time, or a range such as "70-80" when the planner shows several trips.
        if m_entry := re.fullmatch(r"(\d+)\s*(?:[-–]\s*(\d+))?", entry):
            lo = int(m_entry[1])
            hi = int(m_entry[2] or lo)
            d = minutes - hi if minutes > hi else minutes - lo if minutes < lo else 0
            diffs.append(d)
            diff = f"{d:+d}"
        ns = ""
        if no_sbahn is not None:
            ns_min = int(no_sbahn["transit_p50"][u, v])
            ns = f"{ns_min}" + (f" (+{ns_min - int(m['transit_p50'][u, v])})" if ns_min != m["transit_p50"][u, v] else "")
        lines.append(
            f"| {i} | {kind} | {a['name']} ({a['listed_district']}.) | {b['name']} ({b['listed_district']}.) "
            f"| {km(a, b):.1f} | {walk} | {transit} | {minutes} {mode} | {entry} | {diff} | {ns} "
            f"| [Google Maps]({gmaps(a, b, mode)}) |")

    if diffs:
        med = statistics.median(abs(x) for x in diffs)
        verdict = "**PASS**" if med <= 5 else "**FAIL**"
        lines += ["", f"Checked {len(diffs)} of {len(legs)} legs. Median absolute difference: "
                      f"{med:g} min → {verdict} (threshold 5 min)."]
    else:
        lines += ["", "No WienMobil times entered yet."]

    sbahn_line = "not computed"
    if no_sbahn is not None:
        ns50 = no_sbahn["transit_p50"][off].astype(int)
        gain = ns50 - m["transit_p50"][off].astype(int)
        sbahn_line = (f"faster for {int((gain > 0).sum())} of {int(off.sum())} pairs; "
                      f"mean gain where faster {gain[gain > 0].mean():.1f} min, max {int(gain.max())} min")

    lines += [
        "",
        "## Run",
        "",
        "| | |", "|---|---|",
        f"| Points | {n} |",
        f"| Network build | {stats['network_s']:.0f} s |",
        f"| Transit matrix (p25/p50/p75, 12-hour window) | {stats['transit_s']:.0f} s |",
        f"| Walk matrix | {stats['walk_s']:.0f} s |",
        f"| Total | {stats['total_s']:.0f} s |",
        f"| Peak memory (process RSS, JVM capped at {stats['max_memory']}) | {stats['peak_rss_mb'] / 1024:.1f} GB |",
        f"| r5py | {manifest['r5py']} |",
        f"| Departure window | {manifest['departure']} + {manifest['window_hours']:g} h |",
        f"| Walking speed | {manifest['speed_walking_kmh']} km/h |",
        f"| Matrix size | {n}² = {n * n} bytes each, Uint8, 255 = unreachable |",
        f"| Transit p50 over all pairs | median {np.median(p50):.0f} min, max {p50.max():.0f} min |",
        f"| Unreachable on foot within 2 h | {int((m['walk'][off] == UNREACHABLE).sum())} pairs (transit covers them) |",
        f"| Unreachable by transit | {int((m['transit_p50'][off] == UNREACHABLE).sum())} pairs |",
        f"| S-Bahn effect (p50) | {sbahn_line} |",
        "",
        "## Data used",
        "",
        "| Data | Source | Service dates / state |",
        "|---|---|---|",
        f"| Streets | Geofabrik Austria extract, clipped to 16.15,48.09,16.61,48.35 | downloaded 2026-11-03 |",
        f"| U-Bahn, tram, bus, Badner Bahn | Wiener Linien GTFS (also Mobility Database mdb-648, identical file) | {feed_dates('wienerlinien.gtfs.zip')} |",
        f"| S-Bahn and regional trains | ÖBB GTFS Soll-Fahrplan 2026 (data.oebb.at, CC BY 4.0, no registration) | {feed_dates('oebb_vienna.gtfs.zip')} |",
        "| District boundaries | Stadt Wien `BEZIRKSGRENZEOGD` via WFS | 23 polygons, AKT_TIMESTAMP 2026-09-01 |",
        "",
        "The ÖBB feed is reduced to S, R, REX and CJX trains with stops inside the bounding box. "
        "Long-distance trains (Railjet, ICE, IC, Nightjet) and the CAT are left out. "
        "The ÖBB feed has no Wiener Linien trips, so the two feeds don't overlap.",
        "",
        f"Official-bar coordinates: see `reports/official_match.md` ({len(osm)} of {len(by_key)} matched to OSM; "
        f"placed by address only: {', '.join(r['name'] for r in by_key.values() if r['coord_source'] != 'osm') or 'none'}).",
    ]
    REPORTS.mkdir(exist_ok=True)
    REPORT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {REPORT}")


if __name__ == "__main__":
    main()
