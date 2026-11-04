"""Fetch website text for tagging and inclusion checks (SPEC 5.4).

Candidates are all OSM venues from the Overpass result that have a website, except
chains and restaurants whose first cuisine is clearly foreign, plus the official bars.
So the import (02) can also use website signals for venues it would otherwise drop.

- Honours robots.txt, waits at least 1 second per domain, generic client name
- Skips social media pages
- Homepage plus up to two drinks/menu/about pages, plain text, about 8,000 characters
- Stored in data/own/website_text/<id>.txt (gitignored, never published)
"""

from __future__ import annotations

import csv
import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup

from common import INTERIM, OWN, RAW, USER_AGENT, log

OUT = OWN / "website_text"
MAX_CHARS = 8000
SOCIAL = re.compile(r"facebook\.|fb\.com|instagram\.|tiktok\.|twitter\.|x\.com|linktr\.ee|youtube\.|google\.|tripadvisor\.", re.I)
SUBPAGE = re.compile(r"getr[äa]nk|karte|menu|men[üu]|speise|bier|drinks|[üu]ber|about|team|geschichte", re.I)
FOREIGN_FIRST = {"pizza", "italian", "asian", "chinese", "japanese", "sushi", "indian", "vietnamese", "thai", "turkish",
                 "greek", "mexican", "korean", "kebab", "ramen", "burger", "italian_pizza", "noodle", "persian", "syrian"}

_domain_lock = threading.Lock()
_domain_next: dict[str, float] = {}
_robots: dict[str, RobotFileParser | None] = {}


def wait_for(domain: str) -> None:
    while True:
        with _domain_lock:
            now = time.time()
            nxt = _domain_next.get(domain, 0)
            if now >= nxt:
                _domain_next[domain] = now + 1.0
                return
        time.sleep(nxt - now)


def allowed(url: str) -> bool:
    p = urlparse(url)
    base = f"{p.scheme}://{p.netloc}"
    with _domain_lock:
        known = base in _robots
    if not known:
        rp = RobotFileParser()
        try:
            wait_for(p.netloc)
            r = requests.get(base + "/robots.txt", headers={"User-Agent": USER_AGENT}, timeout=10)
            rp.parse(r.text.splitlines() if r.status_code == 200 else [])
        except requests.RequestException:
            rp.parse([])
        with _domain_lock:
            _robots[base] = rp
    rp = _robots[base]
    return rp is None or rp.can_fetch(USER_AGENT, url)


def get(url: str) -> requests.Response | None:
    if SOCIAL.search(url) or not allowed(url):
        return None
    wait_for(urlparse(url).netloc)
    try:
        r = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=15)
    except requests.RequestException:
        return None
    if r.status_code != 200 or "html" not in r.headers.get("Content-Type", ""):
        return None
    return r


def page_text(html: str) -> tuple[str, BeautifulSoup]:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "svg", "iframe", "form"]):
        tag.decompose()
    text = re.sub(r"\s+", " ", soup.get_text(" ")).strip()
    return text, soup


def fetch_one(bar_id: str, url: str) -> dict:
    url = url.split(";")[0].strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    path = OUT / (bar_id.replace(":", "_").replace("/", "_") + ".txt")
    if path.exists():
        return {"id": bar_id, "status": "cached", "chars": path.stat().st_size}
    if SOCIAL.search(url):
        return {"id": bar_id, "status": "social"}
    r = get(url)
    if r is None:
        return {"id": bar_id, "status": "failed"}
    r.encoding = r.apparent_encoding if r.encoding in (None, "ISO-8859-1") else r.encoding
    text, soup = page_text(r.text)
    parts = [f"[{r.url}] {text}"]
    host = urlparse(r.url).netloc
    links = []
    for a in soup.find_all("a", href=True):
        href = urljoin(r.url, a["href"]).split("#")[0]
        if urlparse(href).netloc == host and href != r.url and SUBPAGE.search(href + " " + a.get_text(" ")):
            if href not in links and not href.lower().endswith((".pdf", ".jpg", ".png")):
                links.append(href)
    for href in links[:2]:
        sub = get(href)
        if sub is not None:
            sub.encoding = sub.apparent_encoding if sub.encoding in (None, "ISO-8859-1") else sub.encoding
            parts.append(f"[{sub.url}] {page_text(sub.text)[0]}")
    combined = "\n".join(parts)[:MAX_CHARS]
    path.write_text(combined, encoding="utf-8")
    return {"id": bar_id, "status": "ok", "chars": len(combined)}


def safe_fetch(bar_id: str, url: str) -> dict:
    try:
        return fetch_one(bar_id, url)
    except Exception as e:  # malformed URLs, odd encodings: skip the venue, keep going
        return {"id": bar_id, "status": f"error: {type(e).__name__}"}


def candidates() -> dict[str, str]:
    out = {}
    for el in json.loads((RAW / "overpass_bars.json").read_text())["elements"]:
        t = el.get("tags", {})
        url = t.get("website") or t.get("contact:website") or t.get("url")
        if not url or not t.get("name"):
            continue
        first = (t.get("cuisine", "").split(";")[0] or "").strip().lower()
        if t.get("amenity") == "restaurant" and first in FOREIGN_FIRST:
            continue
        out[f"osm:{el['type']}/{el['id']}"] = url
    official = INTERIM / "bars.json"
    if official.exists():
        for b in json.loads(official.read_text(encoding="utf-8"))["bars"]:
            if b["official"] and b.get("website"):
                out.setdefault(b["id"], b["website"])
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    todo = candidates()
    log(f"{len(todo)} venues with websites")
    results = []
    with ThreadPoolExecutor(max_workers=32) as pool:
        for i, res in enumerate(pool.map(lambda kv: safe_fetch(*kv), todo.items()), 1):
            results.append(res)
            if i % 200 == 0:
                log(f"{i}/{len(todo)}")
    counts: dict[str, int] = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    with open(INTERIM / "website_fetch.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "status", "chars"])
        w.writeheader()
        w.writerows(results)
    log(f"done: {counts}")


if __name__ == "__main__":
    main()
