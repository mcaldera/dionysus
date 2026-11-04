"""Find bar names in pasted forum threads (data/own/tips/*.txt or .html) for tagging by hand.

Reddit blocks automated access, so threads are pasted by the owner: open the thread,
select all, copy, and save as a .txt file in data/own/tips/ with the thread URL on the
first line. This script lists every known bar name that occurs in each file, with the
surrounding text, in data/interim/tagging/forum_mentions.md. Claude then reads that file
(and the threads for places we don't know yet), classifies each recommendation as
guenstig / urig / rau / atzig, skips warnings, and appends rows to data/own/tips.csv.

Usage: python pipeline/forum_mentions.py
"""

from __future__ import annotations

import html
import json
import re

from unidecode import unidecode

from common import INTERIM, OWN, log

TIPS_DIR = OWN / "tips"
OUT = INTERIM / "tagging" / "forum_mentions.md"
CONTEXT = 160
# Names too generic to search for on their own.
GENERIC = {"cafe", "espresso", "pub", "bar", "beisl", "gasthaus", "stuberl", "eck", "treff", "wirtshaus", "heuriger",
           "restaurant", "cafe bar", "kaffee", "bierstube", "zum", "zur", "das", "der", "die"}


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", unidecode(s).lower()).strip()


def text_of(path) -> tuple[str, str]:
    raw = path.read_text(encoding="utf-8", errors="replace")
    lines = raw.splitlines()
    url = lines[0].strip() if lines and lines[0].startswith("http") else ""
    if path.suffix == ".html":
        raw = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw, flags=re.S)
        raw = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    return url, re.sub(r"\s+", " ", raw)


def main() -> None:
    bars = json.loads((INTERIM / "bars.json").read_text(encoding="utf-8"))["bars"]
    names = {}
    for b in bars:
        n = norm(re.sub(r"\(.*?\)", "", b["name"]))
        if len(n) >= 4 and n not in GENERIC:
            names.setdefault(n, []).append(b)
    files = sorted(p for p in TIPS_DIR.glob("*") if p.suffix in (".txt", ".html") and p.name != "README.txt")
    lines = ["# Forum mentions", ""]
    for path in files:
        url, text = text_of(path)
        low = norm(text)
        found = []
        for n, bs in names.items():
            for m in re.finditer(rf"(?<![a-z0-9]){re.escape(n)}(?![a-z0-9])", low):
                found.append((m.start(), n, bs))
        found.sort()
        lines += [f"## {path.name}", f"URL: {url or '(missing: put the thread URL on the first line)'}",
                  f"{len(found)} mentions of known bars", ""]
        for pos, n, bs in found:
            snippet = low[max(0, pos - CONTEXT): pos + len(n) + CONTEXT]
            where = "; ".join(f"{b['name']} ({b['district']}., {b['id']})" for b in bs[:3])
            lines += [f"- **{where}**: …{snippet}…"]
        lines.append("")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    log(f"{len(files)} files, wrote {OUT}")


if __name__ == "__main__":
    main()
