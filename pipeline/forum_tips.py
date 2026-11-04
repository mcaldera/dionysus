"""Turn hand-classified forum mentions into tips (data/own/forum_mentions.tsv -> data/own/tips.csv).

forum_mentions.tsv has one row per place mentioned in a Reddit thread, classified by hand
(see forum_mentions.py) by what the comment praises it for:
  urig        traditional, unchanged, cosy ("in der Zeit stehen geblieben", "urig")
  rau         rough and loved for it ("ranzig", "grindig", "Bauchstich", "tiaf")
  guenstig    explicitly cheap
  bier        good or unusual beer
  alternativ  left-alternative or student scene
  atzig       loud party, karaoke, disco
Warnings ("geh da nicht hin") and places reported closed are not in the file.

Weight of a mention = comment upvotes (capped) shared among the places that comment names
(approximated by rows with the same thread and score). Per place, every kind with at least
30% of its weight becomes one tip row with source "r/wien" and the thread that carries most
of that kind as link. Strength: "stark" for places in 3+ threads, with high weight, or in 2
threads with some weight; the rest "erwähnt". Only strong places that the bar import didn't
keep are passed on (and then added from OSM by 03_match_official.py); weak mentions of
those are just reported.

Usage: python pipeline/forum_tips.py   (then re-run 03, 05, 06, 07)
"""

from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict

from common import INTERIM, OWN, log

SOURCE = "r/wien"
THREADS = {
    "r1": "https://www.reddit.com/r/wien/comments/1se9jk9/die_sch%C3%A4bigsten_beislbars_in_jedem_bezirk/",
    "r2": "https://www.reddit.com/r/wien/comments/1cazlch/ranzigste_beisln_in_wien/",
    "r3": "https://www.reddit.com/r/wien/comments/1mqbfjc/gibt_es_noch_g%C3%BCnstige_bierbeislnurige_cafes_oder/",
    "r4": "https://www.reddit.com/r/wien/comments/1wizfii/sterben_die_klassischen_wiener_beisln_wirklich/",
    "r5": "https://www.reddit.com/r/wien/comments/11bgxdh/sch%C3%A4bigste_g%C3%A4steh%C3%A4userkneipenbeisl_in_wien/",
    "r6": "https://www.reddit.com/r/wien/comments/1ec164c/was_sind_eure_lieblings_ranz_kneipen_in_der_stadt/",
    "r7": "https://www.reddit.com/r/wien/comments/179b00g/interessante_kneipen_in_wien/",
    "r8": "https://www.reddit.com/r/wien/comments/16xs4kx/interessante_bars_in_wien_mit_gutem_bier/",
    "r9": "https://www.reddit.com/r/wien/comments/1o1vmde/alkoholiker_kneipen_in_wien/",
    "r10": "https://www.reddit.com/r/wien/comments/9hkloq/lokale_zum_versumpern_grindig_aber_mit_charme/",
    "r11": "https://www.reddit.com/r/wien/comments/1obf978/hilfe_gutes_uriges_barrierefreies_wirtshaus/",
    "r12": "https://www.reddit.com/r/wien/comments/1kg0xtp/empfehlung_f%C3%BCr_ein_typisches_wiener_lokal_n%C3%A4he/",
}
SCORE_CAP = 80
KIND_SHARE = 0.3
FIELDS = ["name", "district", "street", "source", "kind", "url", "weight", "threads", "strength"]


def strength(threads: int, weight: float) -> str:
    return "stark" if threads >= 3 or weight >= 20 or (threads >= 2 and weight >= 8) else "erwähnt"


def main() -> None:
    rows = list(csv.DictReader(open(OWN / "forum_mentions.tsv", encoding="utf-8"), delimiter="\t"))
    same_comment = Counter((r["thread"], r["score"]) for r in rows)
    places: dict[tuple[str, int], dict] = defaultdict(lambda: {"threads": set(), "kinds": defaultdict(float),
                                                                "by_thread": defaultdict(lambda: defaultdict(float))})
    unresolved = Counter()
    for r in rows:
        w = (min(max(int(r["score"]), 0), SCORE_CAP) + 1) / same_comment[(r["thread"], r["score"])]
        if not r["place"]:
            unresolved[(r["name"], r["district"])] += w
            continue
        p = places[(r["place"], int(r["district"]))]
        p["threads"].add(r["thread"])
        p["kinds"][r["kind"]] += w
        p["by_thread"][r["kind"]][r["thread"]] += w

    kept = {(b["name"], b["district"]) for b in json.loads((INTERIM / "bars.json").read_text(encoding="utf-8"))["bars"]}
    out, report = [], []
    for (name, district), p in sorted(places.items(), key=lambda kv: -sum(kv[1]["kinds"].values())):
        total = sum(p["kinds"].values())
        level = strength(len(p["threads"]), total)
        if (name, district) not in kept and level != "stark":
            report.append(f"- {name} ({district}.): only mentioned in passing and not in the bar list, left out")
            continue
        top = max(p["kinds"].values())
        for kind, w in sorted(p["kinds"].items(), key=lambda kv: -kv[1]):
            if w < KIND_SHARE * total and w < top:
                continue
            thread = max(p["by_thread"][kind].items(), key=lambda kv: kv[1])[0]
            out.append({"name": name, "district": district, "street": "", "source": SOURCE, "kind": kind,
                        "url": THREADS[thread], "weight": round(w, 1), "threads": len(p["threads"]), "strength": level})

    path = OWN / "tips.csv"
    existing = [r for r in csv.DictReader(open(path, encoding="utf-8")) if r["source"] != SOURCE]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, lineterminator="\n", extrasaction="ignore")
        w.writeheader()
        w.writerows([{k: r.get(k, "") for k in FIELDS} for r in existing] + out)

    lines = ["# Forum tips (r/wien)", "", f"{len(places)} places, {len(out)} tip rows "
             f"({sum(1 for o in out if o['strength'] == 'stark')} strong).", "",
             "## Not in OpenStreetMap (need an address to add)", ""]
    lines += [f"- {n} ({d or '?'}.), weight {w:.1f}" for (n, d), w in unresolved.most_common()]
    lines += ["", "## Left out", ""] + report
    (INTERIM / "tagging" / "forum_tips_report.md").write_text("\n".join(lines), encoding="utf-8")
    log(f"{len(out)} tip rows for {len({(o['name'], o['district']) for o in out})} places; "
        f"{len(unresolved)} names not in OSM")


if __name__ == "__main__":
    main()
