"""Write reports/bars.md for the Phase 2 gate from data/interim/bars.json."""

from __future__ import annotations

import json
import random
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import INTERIM, OFFICIAL_CSVS, REPORTS  # noqa: E402

TYPES = ["pub_bar", "tschocherl", "beisl_wirtshaus", "heuriger", "special"]
TYPE_LABEL = {"pub_bar": "Bar & Pub", "tschocherl": "Tschocherl & Café-Bar", "beisl_wirtshaus": "Beisl & Wirtshaus",
              "heuriger": "Heuriger", "special": "Besondere Orte"}


def pct(n: int, d: int) -> str:
    return f"{n} ({100 * n / d:.0f}%)" if d else "0"


def main() -> None:
    d = json.loads((INTERIM / "bars.json").read_text(encoding="utf-8"))
    bars, stats, official = d["bars"], d["stats"], d["official"]
    newest = OFFICIAL_CSVS[-1].stem.removeprefix("official_")
    n = len(bars)

    lines = [
        "# Bars (Phase 2 gate)",
        "",
        f"OSM data as of {stats['osm_timestamp']} (Overpass, the query from SPEC 5.2, which works as written). "
        f"{stats['elements']} elements returned.",
        "",
        f"**{n} bars** after filters, deduplication and adding official bars. "
        "Above the 1,000 the spec plans for, after the owner's narrowing; travel matrices are no problem at this size.",
        "",
        "## What was dropped",
        "",
        "| Reason | Count |", "|---|---|",
        *[f"| {k} | {v} |" for k, v in sorted(stats["dropped"].items(), key=lambda x: -x[1])],
        f"| duplicate (similar name, < 30 m) | {stats['duplicates']} |",
        "",
        "*Other restaurant* means `amenity=restaurant` with a non-Austrian cuisine (pizza, sushi, kebab, ...), or "
        "with neither an Austrian/regional cuisine tag nor Gasthaus, Beisl, Wirtshaus, Bräu, Stüberl, Weinhaus, "
        "Wirt, Schenke, Stadl or similar in the name. "
        "*Chain* covers Aida, Starbucks, Oberlaa, Segafredo, Tchibo, Anker, Der Mann, McCafé, Ströck, "
        "Coffeeshop Company, Wild Bean Cafe, Teeamo, Julius Meinl, Admiral Sportwetten and similar.",
        "",
        "Duplicate examples (kept ← dropped): " + "; ".join(f"{a} ← {b}" for a, b in stats["duplicate_examples"][:8]) + ".",
        "",
        "## Bars per district and type",
        "",
        "| Bezirk | " + " | ".join(TYPE_LABEL[t] for t in TYPES) + " | Total | Opening hours | Website |",
        "|---|" + "---|" * (len(TYPES) + 3),
    ]
    by = Counter((b["district"], b["venueType"]) for b in bars)
    for dist in range(1, 24):
        db = [b for b in bars if b["district"] == dist]
        warn = " ⚠️" if len(db) < 5 else ""
        lines.append(f"| {dist} | " + " | ".join(str(by[(dist, t)]) for t in TYPES)
                     + f" | {len(db)}{warn} | {pct(sum(bool(b['openingHoursText']) for b in db), len(db))} "
                       f"| {pct(sum(bool(b['website']) for b in db), len(db))} |")
    tot = Counter(b["venueType"] for b in bars)
    lines.append("| **Total** | " + " | ".join(f"**{tot[t]}**" for t in TYPES)
                 + f" | **{n}** | {pct(sum(bool(b['openingHoursText']) for b in bars), n)} "
                   f"| {pct(sum(bool(b['website']) for b in bars), n)} |")
    small = [dist for dist in range(1, 24) if sum(b["district"] == dist for b in bars) < 5]
    lines += ["", "Every district has at least 5 bars." if not small
              else f"⚠️ Fewer than 5 bars in district(s): {', '.join(map(str, small))}."]

    lines += ["", "### Opening hours and websites by type", "",
              "| Type | Bars | Opening hours | Website |", "|---|---|---|---|"]
    for t in TYPES:
        tb = [b for b in bars if b["venueType"] == t]
        lines.append(f"| {TYPE_LABEL[t]} | {len(tb)} | {pct(sum(bool(b['openingHoursText']) for b in tb), len(tb))} "
                     f"| {pct(sum(bool(b['website']) for b in tb), len(tb))} |")

    # Official lists
    status = Counter(r["import_status"] for r in official)
    in_import = status["in import"] + status["in import, nearby object"]
    new_recs = [r for r in official if newest in r["editions"]]
    new_in = sum(r["import_status"].startswith("in import") for r in new_recs)
    lines += [
        "", "## Official bars", "",
        f"All {len(official)} venues from both lists are in the bar list. "
        f"{pct(in_import, len(official))} were already in the OSM import; the rest were added. "
        f"Newest edition ({newest}): {new_in} of {len(new_recs)} in the import.",
        "",
        "| How | Count |", "|---|---|", *[f"| {k} | {v} |" for k, v in status.items()],
        "",
        "Official bars the import didn't contain, and why:",
        "",
        "| Bezirk | Name | OSM tagging | Why the import missed it |", "|---|---|---|---|",
    ]
    by_id = {b["id"]: b for b in bars}
    for r in official:
        if r["import_status"].startswith("in import"):
            continue
        b = by_id[r["bar_id"]]
        osm = b.get("osm", {})
        tag = ", ".join(f"{k}={v}" for k, v in osm.items() if k in ("amenity", "leisure", "cuisine")) or r["osm_kind"] or "–"
        if not r["osm_id"]:
            why = "not in OSM"
        elif r["pip_district"] is None:
            why = "outside Vienna"
        elif osm.get("amenity") == "restaurant" and not osm.get("cuisine"):
            why = "restaurant without cuisine tag or Gasthaus-type name"
        elif osm.get("amenity") == "restaurant":
            why = "restaurant with non-Austrian cuisine"
        else:
            why = "not a pub, bar, café or restaurant in OSM"
        lines.append(f"| {r['listed_district']} | {r['name']} | {tag} | {why} |")
    lines += [
        "",
        "The *restaurant without cuisine tag* cases are classic Wirtshäuser. The spec's rule drops "
        "untagged restaurants, so similar non-official Wirtshäuser are missing too. One option: also keep "
        "untagged restaurants with a beer or Austrian signal on their website (Phase 4 fetches websites anyway).",
    ]

    lines += [
        "", "## Owner decisions applied (2026-11-03)", "",
        "- **Cafés narrowed (A + B + C):** removed coffee, cake and breakfast cafés (A), cafés that always close "
        "by 18:00 (B), and cafés with neither opening hours nor website (C). Heurigen and official bars are kept.",
        "- **Food places out:** a Gasthaus or café may only list Austrian-type or neutral cuisines; one value "
        "such as pizza, sushi, kebab or asian rules it out. Pubs and bars are kept whatever they serve.",
        "- **Untagged Wirtshäuser:** in Phase 4, restaurants without a cuisine tag get a website check for a "
        "Wirtshaus or beer signal, and those that pass are added.",
    ]

    # Random sample
    rng = random.Random(30)
    sample = rng.sample(bars, 30)
    lines += ["", "## Random sample of 30", "",
              "| Bezirk | Name | Type | OSM | Opening hours | Website | Official |", "|---|---|---|---|---|---|---|"]
    for b in sorted(sample, key=lambda b: (b["district"], b["name"])):
        osm = ", ".join(f"{k}={v}" for k, v in b.get("osm", {}).items() if k in ("amenity", "cuisine"))
        hours = (b["openingHoursText"] or "–").replace("|", "/")
        if len(hours) > 40:
            hours = hours[:38] + "…"
        lines.append(f"| {b['district']} | {b['name'].replace('|', '/')} | {TYPE_LABEL[b['venueType']]} | {osm} "
                     f"| {hours} | {'ja' if b['website'] else '–'} | {', '.join(b['official']) or '–'} |")

    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "bars.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("wrote reports/bars.md")


if __name__ == "__main__":
    main()
