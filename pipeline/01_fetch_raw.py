"""Download the OSM extract, GTFS feeds and district boundaries, cached in data/raw/.

Also clips the Austria extract to Vienna and builds a Vienna-only ÖBB feed
(S-Bahn and regional trains) that r5py can read alongside the Wiener Linien feed.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import zipfile
from datetime import date

from common import (
    AUSTRIA_PBF_URL, BBOX, DISTRICTS_WFS_URL, OEBB_GTFS_URL, RAW,
    WIENER_LINIEN_GTFS_URL, download, log, run,
)

# Train categories usable with a normal Vienna ticket. Long-distance trains
# (RJ, RJX, ICE, IC, EC, NJ, EN, D) and the CAT airport train are left out.
OEBB_TRAIN_CATEGORIES = {"S", "R", "REX", "CJX"}
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def clip_osm() -> None:
    src = download(AUSTRIA_PBF_URL, RAW / "austria-latest.osm.pbf")
    dest = RAW / "vienna.osm.pbf"
    if dest.exists():
        log(f"cached: {dest.name}")
        return
    bbox = ",".join(str(v) for v in BBOX)
    run(["osmium", "extract", "-b", bbox, str(src), "-o", str(dest), "--overwrite"])


def read_csv(z: zipfile.ZipFile, name: str) -> list[dict]:
    with z.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, "utf-8-sig")))


def write_csv(z: zipfile.ZipFile, name: str, rows: list[dict], fields: list[str]) -> None:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    z.writestr(name, buf.getvalue())


def in_bbox(lat: float, lon: float) -> bool:
    return BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


def build_oebb_vienna() -> None:
    """Keep S-Bahn and regional train stops inside the bbox, drop shapes and pathways."""
    src = download(OEBB_GTFS_URL, RAW / "oebb_raw.gtfs.zip")
    dest = RAW / "oebb_vienna.gtfs.zip"
    if dest.exists():
        log(f"cached: {dest.name}")
        return
    zin = zipfile.ZipFile(src)
    prefix = next((n.split("/")[0] + "/" for n in zin.namelist() if n.endswith("/agency.txt")), "")

    stops = read_csv(zin, prefix + "stops.txt")
    keep_stops = {s["stop_id"] for s in stops
                  if s["stop_lat"] and in_bbox(float(s["stop_lat"]), float(s["stop_lon"]))}

    trips = read_csv(zin, prefix + "trips.txt")
    def category(t: dict) -> str:
        m = re.match(r"[A-Za-z]+", t.get("trip_short_name", ""))
        return m.group(0) if m else ""
    trips = [t for t in trips if category(t) in OEBB_TRAIN_CATEGORIES]
    trip_ids = {t["trip_id"] for t in trips}

    log("filtering ÖBB stop_times")
    by_trip: dict[str, list[dict]] = {}
    for st in read_csv(zin, prefix + "stop_times.txt"):
        if st["trip_id"] in trip_ids and st["stop_id"] in keep_stops:
            by_trip.setdefault(st["trip_id"], []).append(st)
    by_trip = {k: v for k, v in by_trip.items() if len(v) >= 2}
    stop_times = [st for v in by_trip.values() for st in v]
    trips = [t for t in trips if t["trip_id"] in by_trip]

    used_stops = {st["stop_id"] for st in stop_times}
    parents = {s["parent_station"] for s in stops if s["stop_id"] in used_stops and s["parent_station"]}
    out_stops = []
    for s in stops:
        if s["stop_id"] in used_stops or s["stop_id"] in parents:
            s = dict(s)
            s["level_id"] = ""
            out_stops.append(s)

    route_ids = {t["route_id"] for t in trips}
    service_ids = {t["service_id"] for t in trips}
    routes = [r for r in read_csv(zin, prefix + "routes.txt") if r["route_id"] in route_ids]
    agency_ids = {r["agency_id"] for r in routes}
    agency = [a for a in read_csv(zin, prefix + "agency.txt") if a["agency_id"] in agency_ids]
    calendar = [c for c in read_csv(zin, prefix + "calendar.txt") if c["service_id"] in service_ids]
    cal_dates = [c for c in read_csv(zin, prefix + "calendar_dates.txt") if c["service_id"] in service_ids]

    # Avoid ID clashes with the Wiener Linien feed when r5py merges feeds.
    for a in agency:
        a["agency_id"] = "oebb-" + a["agency_id"]
    for r in routes:
        r["agency_id"] = "oebb-" + r["agency_id"]

    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zout:
        write_csv(zout, "agency.txt", agency, list(agency[0].keys()))
        write_csv(zout, "stops.txt", out_stops,
                  ["stop_id", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station", "platform_code"])
        write_csv(zout, "routes.txt", routes, list(routes[0].keys()))
        write_csv(zout, "trips.txt", trips,
                  ["route_id", "service_id", "trip_id", "trip_headsign", "trip_short_name", "direction_id", "block_id"])
        write_csv(zout, "stop_times.txt", stop_times,
                  ["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "pickup_type", "drop_off_type"])
        write_csv(zout, "calendar.txt", calendar, list(calendar[0].keys()))
        write_csv(zout, "calendar_dates.txt", cal_dates, list(cal_dates[0].keys()))
    log(f"ÖBB Vienna feed: {len(trips)} trips, {len(out_stops)} stops, {len(routes)} routes")


def trips_on(feed: str, day: date) -> int:
    """Number of trips active on a date, from calendar.txt plus calendar_dates.txt."""
    z = zipfile.ZipFile(RAW / feed)
    prefix = next((n.split("/")[0] + "/" for n in z.namelist() if n.endswith("/agency.txt")), "")
    ds = day.strftime("%Y%m%d")
    active = {c["service_id"] for c in read_csv(z, prefix + "calendar.txt")
              if c["start_date"] <= ds <= c["end_date"] and c[WEEKDAYS[day.weekday()]] == "1"}
    for c in read_csv(z, prefix + "calendar_dates.txt"):
        if c["date"] == ds:
            (active.add if c["exception_type"] == "1" else active.discard)(c["service_id"])
    return sum(1 for t in read_csv(z, prefix + "trips.txt") if t["service_id"] in active)


def fetch_districts() -> None:
    dest = download(DISTRICTS_WFS_URL, RAW / "districts_wien.geojson")
    n = len(json.loads(dest.read_text())["features"])
    if n != 23:
        raise SystemExit(f"expected 23 districts, got {n}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check-date", default="2026-11-14", help="Saturday used for travel times")
    args = ap.parse_args()

    clip_osm()
    download(WIENER_LINIEN_GTFS_URL, RAW / "wienerlinien.gtfs.zip")
    build_oebb_vienna()
    fetch_districts()

    day = date.fromisoformat(args.check_date)
    for feed in ["wienerlinien.gtfs.zip", "oebb_vienna.gtfs.zip"]:
        n = trips_on(feed, day)
        log(f"{feed}: {n} trips on {day} ({day.strftime('%A')})")
        if n == 0:
            raise SystemExit(f"{feed} has no service on {day}; pick a date inside the feed")


if __name__ == "__main__":
    main()
