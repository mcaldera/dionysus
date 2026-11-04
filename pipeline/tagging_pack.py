"""Prepare the next tagging batch for Claude Code (SPEC 5.5, tagging stage 1).

Picks up to 15 bars per district, taking owner tips first, then official bars, other
tips, bars with website text, and Bar & Pub or Beisl & Wirtshaus before other types.
Batches go round-robin across districts. For each bar it writes a short evidence pack
(OSM tags, opening hours, the website sentences that matter for tags) to
data/interim/tagging/batch_NNN.md. Bars already in data/interim/tagging/done.txt are skipped.

Usage: python pipeline/tagging_pack.py [--size 25]
After tagging, append rows to data/own/tags.csv and the batch's bar ids to done.txt.
"""

from __future__ import annotations

import argparse
import json
import re

from common import INTERIM, OWN

PER_DISTRICT = 15
DIR = INTERIM / "tagging"
KEYWORDS = re.compile(
    r"€|euro|preis|günstig|billig|bier|seidl|krügerl|fass|zapf|wein|spritzer|cocktail|urig|gemütlich|tradition"
    r"|seit 1\d{3}|seit 20\d\d|stammg|modern|design|neu eröffnet|concept|gehoben|fine dining|gourmet|haube|menü"
    r"|küche|speise|essen|schnitzel|gulasch|toast|snack|garten|schanigarten|terrasse|innenhof|live|konzert|musik|dj"
    r"|band|darts|billard|wuzzler|fußball|sky|karaoke|spät|bis \d+|nacht", re.I)


def website_text(bar_id: str) -> str | None:
    path = OWN / "website_text" / (bar_id.replace(":", "_").replace("/", "_") + ".txt")
    return path.read_text(encoding="utf-8") if path.exists() else None


def snippets(text: str, limit: int = 1100) -> str:
    sentences = re.split(r"(?<=[.!?])\s+|\s{2,}|\s[|•·]\s", text)
    out, seen = [], set()
    for s in sentences:
        s = s.strip()
        if 15 <= len(s) <= 300 and KEYWORDS.search(s) and s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
        if sum(len(x) for x in out) > limit:
            break
    return " … ".join(out)[:limit]


def priority(b: dict, newest: str) -> tuple:
    tips = b.get("tips", [])
    return (
        not any(t["source"] == "owner" for t in tips),
        newest not in b["official"],
        not tips,
        website_text(b["id"]) is None,
        b["venueType"] not in ("pub_bar", "beisl_wirtshaus"),
        b["name"],
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=25)
    args = ap.parse_args()
    DIR.mkdir(parents=True, exist_ok=True)
    done_path = DIR / "done.txt"
    done = set(done_path.read_text().split()) if done_path.exists() else set()
    bars = json.loads((INTERIM / "bars.json").read_text(encoding="utf-8"))["bars"]
    newest = max(e for b in bars for e in b["official"])

    queues = {}
    for d in range(1, 24):
        ranked = sorted((b for b in bars if b["district"] == d), key=lambda b: priority(b, newest))[:PER_DISTRICT]
        queues[d] = [b for b in ranked if b["id"] not in done]
    batch = []
    while len(batch) < args.size and any(queues.values()):
        for d in range(1, 24):
            if queues[d] and len(batch) < args.size:
                batch.append(queues[d].pop(0))
    if not batch:
        print("stage 1 complete")
        return

    n = len(list(DIR.glob("batch_*.md"))) + 1
    lines = [f"# Tagging batch {n:03d}", ""]
    for b in batch:
        osm = ", ".join(f"{k}={v}" for k, v in b.get("osm", {}).items())
        tips = "; ".join(t["source"] + (f" ({t['kind']})" if t.get("kind") else "") for t in b.get("tips", []))
        text = website_text(b["id"])
        lines += [
            f"## {b['id']} | {b['name']} | {b['district']}. | {b['venueType']}",
            f"OSM: {osm or '–'} | Hours: {b.get('openingHoursText') or '–'} | Official: {','.join(b['official']) or '–'}"
            + (f" | Tips: {tips}" if tips else ""),
            f"Web: {snippets(text) if text else '– (no website text)'}",
            "",
        ]
    path = DIR / f"batch_{n:03d}.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {path} with {len(batch)} bars")


if __name__ == "__main__":
    main()
