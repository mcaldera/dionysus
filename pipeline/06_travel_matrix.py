"""Compute walk and transit (p25, p50, p75) travel-time matrices with r5py.

Output (SPEC 5.7): one file per matrix, n × n bytes, row-major Uint8, whole minutes,
255 = unreachable, diagonal 0. Row and column order are in manifest.json.

Phase 1 ran this on the official bars only:
    python pipeline/06_travel_matrix.py --points data/interim/official_points.csv --out data/interim/phase1
All bars (Phase 3): r5py computes origins one after another, so split them into
chunks run as parallel processes, then merge (pipeline/run_travel_matrix.sh does this):
    python pipeline/06_travel_matrix.py --points data/interim/bars.json --out public/data/travel --chunk 0 --chunks 32
    ...
    python pipeline/06_travel_matrix.py --points data/interim/bars.json --out public/data/travel --merge --chunks 32
"""

from __future__ import annotations

import argparse
import csv
import json
import resource
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--points", required=True, help="CSV with key, name, lat, lon, or data/interim/bars.json")
ap.add_argument("--out", required=True, help="output directory")
ap.add_argument("--departure", default="2026-11-14T10:00", help="Saturday inside the feed's service dates")
ap.add_argument("--window-hours", type=float, default=12)
ap.add_argument("--speed-walking", type=float, default=4.8)
ap.add_argument("--max-memory", default="12G")
ap.add_argument("--no-sbahn", action="store_true", help="Wiener Linien feed only, for comparison")
ap.add_argument("--chunks", type=int, default=1, help="split origins into this many chunks")
ap.add_argument("--chunk", type=int, help="compute only this chunk (0-based) into <out>/parts/")
ap.add_argument("--merge", action="store_true", help="assemble <out>/parts/ into the matrix files")
args = ap.parse_args()

# r5py reads its JVM settings from the command line at import time.
sys.argv = [sys.argv[0], "--max-memory", args.max_memory]

import numpy as np  # noqa: E402
import geopandas as gpd  # noqa: E402
import r5py  # noqa: E402
from shapely.geometry import Point  # noqa: E402

sys.path.insert(0, str(Path(__file__).parent))
from common import RAW, log  # noqa: E402

UNREACHABLE = 255


def load_points(path: str) -> gpd.GeoDataFrame:
    """CSV with key, name, lat, lon, or a bars.json from 03_match_official.py."""
    if path.endswith(".json"):
        bars = json.loads(Path(path).read_text(encoding="utf-8"))["bars"]
        rows = [{"key": b["id"], "name": b["name"], "lat": b["lat"], "lon": b["lon"]} for b in bars]
    else:
        with open(path, encoding="utf-8") as f:
            rows = [r for r in csv.DictReader(f) if r["lat"]]
    return gpd.GeoDataFrame(
        {"id": range(len(rows)), "key": [r["key"] for r in rows], "name": [r["name"] for r in rows]},
        geometry=[Point(float(r["lon"]), float(r["lat"])) for r in rows],
        crs="EPSG:4326",
    )


MATRICES = {"walk": "travel_time", "transit_p25": "travel_time_p25",
            "transit_p50": "travel_time_p50", "transit_p75": "travel_time_p75"}


def to_uint8(df, column: str, row0: int, rows: int, n: int) -> np.ndarray:
    """Rows row0 .. row0 + rows of the full matrix."""
    m = np.full((rows, n), UNREACHABLE, dtype=np.uint8)
    vals = df[column].to_numpy(dtype=float)
    ok = ~np.isnan(vals)
    # r5 reports whole minutes already; clip to 254 so 255 stays "unreachable".
    m[df["from_id"].to_numpy()[ok] - row0, df["to_id"].to_numpy()[ok]] = np.clip(np.round(vals[ok]), 0, 254)
    return m


def chunk_range(n: int, chunk: int, chunks: int) -> tuple[int, int]:
    size = -(-n // chunks)
    return chunk * size, min(n, (chunk + 1) * size)


def peak_rss_mb() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024


def main() -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    points = load_points(args.points)
    n = len(points)
    feeds = [RAW / "wienerlinien.gtfs.zip"] + ([] if args.no_sbahn else [RAW / "oebb_vienna.gtfs.zip"])
    if args.merge:
        merge(out, points, feeds)
        return
    chunk = 0 if args.chunk is None else args.chunk
    row0, row1 = chunk_range(n, chunk, args.chunks)
    origins = points.iloc[row0:row1]
    log(f"{n} points, origins {row0}..{row1 - 1}; feeds: {[f.name for f in feeds]}")

    t0 = time.time()
    net = r5py.TransportNetwork(RAW / "vienna.osm.pbf", [str(f) for f in feeds])
    t_net = time.time() - t0
    log(f"network built in {t_net:.0f} s, peak RSS {peak_rss_mb():.0f} MB")

    common = dict(origins=origins, destinations=points, snap_to_network=True,
                  speed_walking=args.speed_walking, max_time=timedelta(hours=2),
                  departure=datetime.fromisoformat(args.departure))

    t1 = time.time()
    transit = r5py.TravelTimeMatrix(
        net,
        departure_time_window=timedelta(hours=args.window_hours),
        percentiles=[25, 50, 75],
        transport_modes=[r5py.TransportMode.TRANSIT, r5py.TransportMode.WALK],
        **common,
    )
    t_transit = time.time() - t1
    log(f"transit matrix in {t_transit:.0f} s; columns {list(transit.columns)}")

    t2 = time.time()
    walk = r5py.TravelTimeMatrix(net, transport_modes=[r5py.TransportMode.WALK], **common)
    t_walk = time.time() - t2
    log(f"walk matrix in {t_walk:.0f} s; columns {list(walk.columns)}")

    rows = {name: to_uint8(walk if name == "walk" else transit, col, row0, row1 - row0, n)
            for name, col in MATRICES.items()}
    stats = {
        "points": n, "origins": row1 - row0, "started": t0,
        "network_s": round(t_net, 1), "transit_s": round(t_transit, 1), "walk_s": round(t_walk, 1),
        "total_s": round(time.time() - t0, 1), "peak_rss_mb": round(peak_rss_mb()), "max_memory": args.max_memory,
    }
    if args.chunks == 1:
        write_outputs(out, points, feeds, rows, stats)
    else:
        (out / "parts").mkdir(exist_ok=True)
        np.savez(out / "parts" / f"part_{chunk:03d}.npz", row0=row0, **rows)
        (out / "parts" / f"part_{chunk:03d}.json").write_text(json.dumps(stats))
        log(f"chunk {chunk} done: {stats}")


def merge(out: Path, points: gpd.GeoDataFrame, feeds: list[Path]) -> None:
    n = len(points)
    full = {name: np.full((n, n), UNREACHABLE, dtype=np.uint8) for name in MATRICES}
    filled = np.zeros(n, dtype=bool)
    parts = []
    for chunk in range(args.chunks):
        row0, row1 = chunk_range(n, chunk, args.chunks)
        data = np.load(out / "parts" / f"part_{chunk:03d}.npz")
        for name in MATRICES:
            full[name][row0:row1] = data[name]
        filled[row0:row1] = True
        parts.append(json.loads((out / "parts" / f"part_{chunk:03d}.json").read_text()))
    if not filled.all():
        raise SystemExit("missing rows")
    finished = max(p["started"] + p["total_s"] for p in parts)
    stats = {
        "points": n, "chunks": args.chunks,
        "wall_s": round(finished - min(p["started"] for p in parts), 1),
        "slowest_chunk_s": max(p["total_s"] for p in parts),
        "cpu_chunk_s_sum": round(sum(p["total_s"] for p in parts)),
        "peak_rss_mb_per_process": max(p["peak_rss_mb"] for p in parts),
        "peak_rss_mb_all_processes": sum(p["peak_rss_mb"] for p in parts),
        "max_memory_per_process": parts[0]["max_memory"],
    }
    write_outputs(out, points, feeds, full, stats)


def write_outputs(out: Path, points, feeds, matrices: dict[str, np.ndarray], stats: dict) -> None:
    n = len(points)
    for name, m in matrices.items():
        np.fill_diagonal(m, 0)
        (out / f"{name}.bin").write_bytes(m.tobytes(order="C"))
        log(f"{name}: {m.size} bytes, {int((m == UNREACHABLE).sum())} unreachable pairs")
    manifest = {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "n": n,
        "order": points["key"].tolist(),
        "names": points["name"].tolist(),
        "departure": datetime.fromisoformat(args.departure).isoformat(),
        "window_hours": args.window_hours,
        "speed_walking_kmh": args.speed_walking,
        "feeds": [f.name for f in feeds],
        "r5py": r5py.__version__,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    stats.pop("started", None)
    (out / "run_stats.json").write_text(json.dumps(stats, indent=1))
    log(f"done: {stats}")


if __name__ == "__main__":
    main()
