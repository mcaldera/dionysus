"""Find published bars that have probably closed for good or turned into something else.

Free, legitimate sources only (no Google, no social media):

1. Cached website text (data/own/website_text/): closure or handover wording, parked or
   for-sale domains, casino/spam takeovers, sites about another business.
2. A polite re-check of websites that failed in step 04 or look suspicious: robots.txt,
   at least 1 s per domain, generic client name, GET of the home page only.
3. One fresh Overpass query: our bar ids (deleted, lifecycle tags, closed hours, notes),
   plus disused/was objects in Vienna. History of deleted elements from the OSM API.
4. OSM Notes in Vienna (open, and closed in the last ~2 years) that report a closure
   within 60 m of a bar.

All network results are cached in data/interim/closure_check/; a re-run only fetches what
is missing. --refresh [overpass notes web history] fetches again, --offline never fetches.

Writes data/interim/closure_candidates.csv and reports/closure_check.md. Evidence is a
short paraphrase, never website text.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import socket
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timezone
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import requests
import urllib3
from bs4 import BeautifulSoup
from rapidfuzz import fuzz

from common import BBOX, INTERIM, OWN, PUBLIC_DATA, RAW, REPORTS, USER_AGENT, load_overrides, log, normalize_name

CACHE = INTERIM / "closure_check"
OUT_CSV = INTERIM / "closure_candidates.csv"
OUT_MD = REPORTS / "closure_check.md"
TEXT_DIR = OWN / "website_text"

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OSM_API = "https://api.openstreetmap.org/api/0.6"
NOTES_DAYS = 730
NOTE_RADIUS_M = 60
MAX_HISTORY_REQUESTS = 25
THIS_YEAR = date.today().year

HEADERS = {"User-Agent": USER_AGENT}
SOCIAL = re.compile(r"facebook\.|fb\.com|instagram\.|tiktok\.|twitter\.|x\.com|linktr\.ee|youtube\.|google\.|tripadvisor\.", re.I)
DRINK_AMENITIES = {"pub", "bar", "biergarten", "restaurant", "cafe", "nightclub"}
LIFECYCLE = ("disused", "was", "abandoned", "demolished", "removed", "razed", "closed")

# Generic words that say nothing about which bar a text is about.
NAME_STOP = set("""
gasthaus gasthof cafe caffe kaffee bar pub beisl beisel restaurant wirtshaus heuriger heurigen zum zur zu den der
die das am an im in beim bei und the wien vienna weinhaus espresso stuberl stueberl buschenschank weingut irish
cocktail cocktails lounge bistro s club klub of and co la le il el da di del wine wein weinbar bier bierbar brau
brauhaus haus alt alte alter neue neuer neu stub n e st sankt musik live de du vom von bierstube stube tschocherl
eck ecke treff schenke nfg familie fam
""".split())


# --- Signals --------------------------------------------------------------------------

@dataclass
class Signal:
    code: str        # e.g. web_closed, osm_gone, note_named
    source: str      # web, osm or note: independent sources are combined
    strength: int    # 3 strong, 2 medium, 1 weak, 0 = not a closure sign (report only)
    evidence: str    # short paraphrase, max ~8 words
    temporary: bool = False


# Weekday, date and holiday context: "Montag geschlossen" is a closing day, not a closure.
CLOSING_DAY = re.compile(
    r"montags?|dienstags?|mittwochs?|donnerstags?|freitags?|samstags?|sonntags?|feiertags?|ruhetag|\bmo\b|\bdi\b|\bmi\b"
    r"|\bdo\b|\bfr\b|\bsa\b|\bso\b|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\.\s?\d{1,2}\."
    r"|\d{1,2}\.\s?(jänner|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)"
    r"|weihnacht|silvester|ostern|betriebsurlaub|urlaub|winterpause|sommerpause|feiertage|heiligabend|neujahr"
    r"|wintersperre|saison", re.I)
# Part of the venue or weather: "Terrasse vorübergehend geschlossen".
PART_OF_VENUE = re.compile(r"terrasse|garten|schanigarten|küche|saal|stüberl|bei (schlechtem|regen)|schnee|wetter|parkplatz"
                           r"|lift|aufzug|toilette|\bwc\b|eingang|standort|filiale|shop|online|lieferservice", re.I)
OLD_YEAR = re.compile(r"\b(1[89]\d\d|20[0-9]\d)\b")
DECADE = re.compile(r"\b(19)?\d0(er|ern|er jahren)\b|jahrhundert", re.I)
DATED = re.compile(r"\d{1,2}\.\s?\d{1,2}\.|\d{1,2}\.\s?(jänner|januar|februar|märz|april|mai|juni|juli|august|september"
                   r"|oktober|november|dezember)", re.I)

PERMANENT = [
    (r"(dauerhaft|endgültig|für immer|permanent)\s+(geschlossen|zugesperrt|geschloßen)", "website announces permanent closure"),
    (r"(dauerhaft|endgültig|für immer)\s+(zusperren|schließen|zu(?=\s*[.!,;]|\s+(sind|haben|bleiben)\b))",
     "website announces permanent closure"),
    (r"\b(haben|hat|wird|werden|sperren|sperrt)\b[^.!?]{0,60}\b(zugesperrt|zusperren)\b", "website says the place has shut"),
    (r"permanently closed|closed permanently|closed for good|closed (its|our) doors|has closed down|we have closed",
     "website announces permanent closure"),
    (r"\b(betrieb|lokal|gasthaus|restaurant|beisl|heurigen?)\s+(wurde |ist |wird )?(eingestellt|aufgelassen|aufgegeben)",
     "website says business was given up"),
    (r"letzte[nrs]?\s+(öffnungs|betriebs|verkaufs|ausschank)tag", "website names a last opening day"),
    (r"(ein|zum) letzte[ns]? mal\b[^.!?]{0,60}(geöffnet|gefeiert|offen|aufgesperrt)", "website names a last opening day"),
]
FAREWELL = [
    (r"\b(wir|ich)\s+(verabschieden uns|verabschiede mich|sagen (danke und )?(servus|adieu|auf wiedersehen|tschüss|baba|lebewohl))",
     "website says goodbye to guests"),
    (r"zeit gekommen,?\s+(um\s+)?(abschied|adieu|servus)", "website says goodbye to guests"),
    (r"(eine ära|ein kapitel|eine epoche)\s+geht\s+zu\s+ende", "website says an era has ended"),
    (r"heißt es abschied nehmen|müssen wir (uns )?(leider )?(abschied nehmen|verabschieden)", "website says goodbye to guests"),
    (r"schweren herzens", "website delivers sad news"),
    (r"(danke|vielen dank|bedanken uns)[^.!?]{0,40}\bfür\s+(\d{1,2}|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf"
     r"|zwölf|zwanzig|dreißig|viele)\s+(\w+\s+)?jahre", "website thanks guests for past years"),
    (r"\b(wir gehen|ich gehe|gehen wir|gehe ich)\b[^.!?]{0,30}(pension|ruhestand)", "website says owners retire"),
    (r"(mich|uns) beruflich (neu )?(zu )?(verändern|umorientieren|neu orientieren)", "website says owner leaves the trade"),
]
CHANGED = [
    (r"\bneuen?\s+(pächter|pächterin|betreiber|betreiberin|besitzer|inhaber|eigentümer)\w*[^.!?]{0,40}"
     r"(übergeben|weitergegeben|verkauft|übernommen)", "website says it went to a new operator"),
    (r"(übergeben|weitergeführt|weitergegeben|übernommen|wiedereröffnet)[^.!?]{0,60}unter dem (neuen )?namen",
     "website says it continues under a new name"),
    (r"unter dem neuen namen|neu eröffnet als|heißt (jetzt|nun|ab sofort)|jetzt neu als|now called|has been renamed",
     "website says it continues under a new name"),
]
TEMPORARY = [
    (r"bis auf weiteres geschlossen|until further notice", "website says closed until further notice"),
    (r"vorr?übergehend geschlossen|temporarily closed|closed for renovation"
     r"|(derzeit|aktuell|momentan|zur zeit|zurzeit) geschlossen", "website says temporarily closed"),
    (r"wegen\s+(umbau|renovierung|sanierung|krankheit|personalmangel|eines technischen gebrechens|wasserschaden)"
     r"[^.!?]{0,40}geschlossen|geschlossen\s+wegen\s+(umbau|renovierung|sanierung|krankheit|personalmangel)",
     "website says closed for repairs or illness"),
]
PARKED = re.compile(
    r"domain (is|may be) for sale|this domain (is|has been|was|may be) (for sale|parked)|buy this domain"
    r"|diese domain (ist|steht|kann|wurde)[^.!?]{0,40}(verkauf|erwerben|kaufen|registriert|reserviert|geparkt)"
    r"|domain kaufen|domain backorder|domain parking|parked free|\bsedo\b|nicsell|dan\.com|afternic|hugedomains"
    r"|domain wurde (soeben |erfolgreich )?registriert", re.I)
PARK_HOSTS = re.compile(r"sedo\.|nicsell\.|dan\.com|afternic\.|hugedomains\.|bodis\.|parkingcrew\.|above\.com|domainmarket"
                        r"|undeveloped\.|uniregistry|namebright|sav\.com|parklogic", re.I)
PLACEHOLDER = re.compile(
    r"account (has been )?suspended|suspendedpage|default (web )?(site )?page|welcome to nginx|apache2? (ubuntu |debian )?"
    r"default page|^\s*it works!|index of /|this domain is registered for one of our customers|hier entsteht (in kürze )?(eine |unsere |die )?(neue )?(internetpräsenz|webseite"
    r"|website|homepage)|webspace (ist )?(noch )?(leer|nicht eingerichtet)|future home of", re.I)
# Only on a very short home page: a site without content.
EMPTY_SITE = re.compile(r"coming soon|nothing to see here|under construction|im aufbau|wird gerade überarbeitet", re.I)
SPAM = re.compile(
    r"casino|\bslots?\b|freispiel|spielautomat|sportwett|wettanbieter|\bjudi\b|gacor|togel|sabung ayam|akun pro|pokies"
    r"|maxwin|online.?wetten|glücksspiel|gambling|\bbetting\b|jackpot|ohne einzahlung|\bkyc\b|bookmaker|buchmacher"
    r"|viagra|cialis|kamagra", re.I)


def compile_all(rules):
    return [(re.compile(p, re.I), ev) for p, ev in rules]


PERMANENT, FAREWELL, CHANGED, TEMPORARY = map(compile_all, (PERMANENT, FAREWELL, CHANGED, TEMPORARY))


# --- Helpers ----------------------------------------------------------------------------

def file_id(bar_id: str) -> str:
    return bar_id.replace(":", "_").replace("/", "_")


def name_tokens(name: str) -> list[str]:
    return [t for t in normalize_name(name).split() if t not in NAME_STOP and len(t) >= 3]


def mentions_name(name: str, *texts: str) -> bool | None:
    """True if a distinctive word of the bar name appears (typos allowed); None if the name has none."""
    toks = name_tokens(name)
    if not toks:
        return None
    blob = " ".join(normalize_name(t).replace(" ", "") for t in texts)
    if any(t in blob for t in toks):
        return True
    return any(len(t) >= 6 and fuzz.partial_ratio(t, blob) >= 88 for t in toks)


def site_domain(url: str) -> str:
    host = urlparse(url if "://" in url else "https://" + url).netloc.lower().split(":")[0]
    parts = host.split(".")
    n = 3 if len(parts) >= 3 and parts[-2] in {"co", "or", "gv", "ac"} else 2
    return ".".join(parts[-n:])


def clean_url(url: str) -> str:
    url = url.split(";")[0].strip()
    return url if url.startswith(("http://", "https://")) else "https://" + url


def distance_m(lat1, lon1, lat2, lon2) -> float:
    dy = (lat2 - lat1) * 111_320
    dx = (lon2 - lon1) * 111_320 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def sentence_at(text: str, start: int, end: int) -> str:
    left = max(text.rfind(c, 0, start) for c in ".!?")
    right = min([i for i in (text.find(c, end) for c in ".!?") if i >= 0] or [len(text)])
    return text[max(left + 1, start - 200):min(right, end + 200)]


def is_history(sentence: str) -> bool:
    """A sentence that only mentions years before last year, or decades, tells the venue's history."""
    years = [int(y) for y in OLD_YEAR.findall(sentence)]
    if years:
        return max(years) < THIS_YEAR - 1
    return bool(DECADE.search(sentence))


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def save_json(path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


# --- Website text -----------------------------------------------------------------------

def cached_segments(bar_id: str) -> list[tuple[str, str]]:
    """[(url, text)] of the pages step 04 stored for a bar: home page first."""
    path = TEXT_DIR / (file_id(bar_id) + ".txt")
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").split("\n"):
        m = re.match(r"\[(\S+)\] ?(.*)", line)
        if m:
            out.append((m.group(1), m.group(2)))
        elif out:
            out[-1] = (out[-1][0], out[-1][1] + " " + line)
    return out


def rule_hits(rules, text: str, closing_day_check: bool = True, skip_dated: bool = False) -> list[str]:
    """Evidence of every rule that matches outside closing-day, venue-part and history context.
    skip_dated: also skip sentences with a date (a scheduled closure, often long past)."""
    hits = []
    for rx, ev in rules:
        for m in rx.finditer(text):
            before = text[max(0, m.start() - 40):m.start()]
            span = m.group(0)
            if closing_day_check and (CLOSING_DAY.search(before[-25:] + " " + span) or PART_OF_VENUE.search(before)):
                continue
            if is_history(sentence_at(text, m.start(), m.end())):
                continue
            window = text[max(0, m.start() - 120):m.end() + 80]
            if skip_dated and (DATED.search(window) or is_history(window)):
                continue
            hits.append(ev)
            break
    return hits


def content_signals(bar: dict, segments: list[tuple[str, str]], website: str) -> list[Signal]:
    """Closure wording, parking, spam and other-business signs in website text."""
    if not segments:
        return []
    sigs: list[Signal] = []
    text = " ".join(t for _, t in segments)
    home_url, home = segments[0]

    permanent = rule_hits(PERMANENT, text)
    farewell = rule_hits(FAREWELL, text, closing_day_check=False)
    changed = rule_hits(CHANGED, text, closing_day_check=False)
    temporary = rule_hits(TEMPORARY, text, skip_dated=True)
    if permanent:
        sigs.append(Signal("web_closed", "web", 3, permanent[0]))
    # Two farewell/handover statements, a farewell next to "closed", or a home page cut down to
    # the farewell read as a closure.
    farewell_like = list(dict.fromkeys(farewell + changed))
    if farewell_like:
        only_farewell = len(home) < 500 and bool(rule_hits(FAREWELL, home, closing_day_check=False))
        strong = len(farewell_like) >= 2 or bool(temporary) or only_farewell
        code = "web_changed" if changed else "web_farewell"
        evidence = "website now only shows a farewell note" if only_farewell and not changed else (changed or farewell)[0]
        sigs.append(Signal(code, "web", 3 if strong else 2, evidence))
    if temporary and not permanent:
        sigs.append(Signal("web_temporary", "web", 1, temporary[0], temporary=True))

    final_host = urlparse(home_url).netloc.lower()
    if PARK_HOSTS.search(final_host) or PARKED.search(home[:3000]):
        sigs.append(Signal("web_parked", "web", 2, "domain parked or offered for sale"))
    elif PLACEHOLDER.search(home[:1500]) or PLACEHOLDER.search(home_url):
        sigs.append(Signal("web_placeholder", "web", 1, "website replaced by a hosting placeholder"))
    elif len(home) < 300 and EMPTY_SITE.search(home) and not temporary:
        sigs.append(Signal("web_placeholder", "web", 1, "website is an empty 'coming soon' page"))

    spam_home = SPAM.findall(home)
    spam_all = SPAM.findall(text)
    redirected = website and site_domain(home_url) != site_domain(website)
    named = mentions_name(bar["name"], home, urlparse(home_url).netloc)
    if len(spam_home) >= 3 and (SPAM.search(home[:160]) or redirected or named is False):
        sigs.append(Signal("web_takeover", "web", 2, "website domain now shows a casino/betting site"))
    elif len(spam_all) >= 5 and len({s.lower() for s in spam_all}) >= 2:
        sigs.append(Signal("web_hacked", "web", 0, "website hacked with casino spam, bar content still there"))
    elif not any(s.code in ("web_parked", "web_placeholder") for s in sigs):
        if mentions_name(bar["name"], text, urlparse(home_url).netloc, website or "") is False and len(text) > 300:
            what = "redirects to" if redirected else "is about"
            sigs.append(Signal("web_other_business", "web", 1, f"website {what} another business (bar not named)"))
    return sigs


# --- Polite website re-check ------------------------------------------------------------

_lock = threading.Lock()
_next_slot: dict[str, float] = {}


def wait_for(domain: str) -> None:
    """At least 1 second between requests to the same domain (SPEC 5.4)."""
    while True:
        with _lock:
            now = time.time()
            nxt = _next_slot.get(domain, 0)
            if now >= nxt:
                _next_slot[domain] = now + 1.0
                return
        time.sleep(nxt - now)


def resolves(host: str) -> bool:
    try:
        socket.getaddrinfo(host, 443)
        return True
    except (socket.gaierror, UnicodeError):
        return False


def page_title_and_text(html: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "lxml")
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    for tag in soup(["script", "style", "noscript", "svg", "iframe", "form"]):
        tag.decompose()
    return title[:200], re.sub(r"\s+", " ", soup.get_text(" ")).strip()[:3000]


def check_site(url: str) -> dict:
    """DNS, robots.txt, then one GET of the home page. Never follows social media."""
    url = clean_url(url)
    p = urlparse(url)
    host = p.netloc.split(":")[0]
    res = {"url": url, "checked": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    if not resolves(host):
        alt = host[4:] if host.startswith("www.") else "www." + host
        if not resolves(alt):
            return res | {"result": "dns"}
        p, host = p._replace(netloc=alt), alt  # e.g. only the bare domain still exists
    home = f"{p.scheme}://{p.netloc}/"
    rp = RobotFileParser()
    try:
        wait_for(host)
        r = requests.get(home + "robots.txt", headers=HEADERS, timeout=(8, 12))
        rp.parse(r.text.splitlines() if r.status_code == 200 else [])
    except requests.RequestException:
        rp.parse([])
    if not rp.can_fetch(USER_AGENT, home):
        return res | {"result": "robots"}
    tries = [(home, True)] + ([("http://" + p.netloc + "/", True)] if p.scheme == "https" else [])
    while tries:
        attempt_url, verify = tries.pop(0)
        wait_for(host)
        try:
            r = requests.get(attempt_url, headers=HEADERS, timeout=(8, 15), verify=verify, allow_redirects=True)
        except requests.exceptions.SSLError:
            if verify:  # retry without certificate check: we only want to know whether a site answers
                tries.insert(0, (attempt_url, False))
            continue
        except requests.exceptions.Timeout:
            res |= {"result": "timeout"}
            continue
        except requests.RequestException as e:
            res |= {"result": "connection", "error": type(e).__name__}
            continue
        if SOCIAL.search(r.url):
            return res | {"result": "social", "status": r.status_code, "final_url": r.url}
        out = res | {"result": "http", "status": r.status_code, "final_url": r.url}
        if r.status_code == 200 and "html" in r.headers.get("Content-Type", ""):
            r.encoding = r.apparent_encoding if r.encoding in (None, "ISO-8859-1") else r.encoding
            out["title"], out["text"] = page_title_and_text(r.text)
        return out
    return res if "result" in res else res | {"result": "connection"}


def recheck_websites(todo: dict[str, str], refresh: bool, offline: bool) -> dict[str, dict]:
    """bar id -> re-check result, cached by URL in websites.json."""
    path = CACHE / "websites.json"
    cache = {} if refresh else (load_json(path) or {})
    urls = sorted({clean_url(u) for u in todo.values()} - set(cache))
    if urls and not offline:
        log(f"re-checking {len(urls)} websites (robots.txt, >= 1 s per domain)")
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        with ThreadPoolExecutor(max_workers=16) as pool:
            for i, res in enumerate(pool.map(check_site, urls), 1):
                cache[res["url"]] = res
                if i % 50 == 0:
                    log(f"{i}/{len(urls)}")
        save_json(path, cache)
    return {bid: cache[clean_url(u)] for bid, u in todo.items() if clean_url(u) in cache}


def recheck_signals(bar: dict, res: dict) -> list[Signal]:
    """Signals of a site that no longer answers properly. Answering sites go through content_signals."""
    kind = res.get("result")
    if kind == "dns":
        return [Signal("web_dead", "web", 1, "website domain no longer resolves")]
    if kind == "connection":
        return [Signal("web_dead", "web", 1, "website server refuses connections")]
    if kind == "timeout":
        return [Signal("web_dead", "web", 1, "website server does not answer")]
    if kind != "http":
        return []
    if res["status"] in (404, 410):
        return [Signal("web_dead", "web", 1, f"website home page gone ({res['status']})")]
    return []


# --- OpenStreetMap ----------------------------------------------------------------------

def overpass_query(bars: list[dict]) -> str:
    ids: dict[str, list[str]] = {"node": [], "way": [], "relation": []}
    for b in bars:
        if b["id"].startswith("osm:"):
            typ, num = b["id"][4:].split("/")
            ids[typ].append(num)
    parts = [f"  {typ}(id:{','.join(nums)});" for typ, nums in ids.items() if nums]
    lifecycle = "|".join(LIFECYCLE)
    return "\n".join([
        "[out:json][timeout:180];",
        'area["name"="Wien"]["admin_level"="4"]->.wien;',
        "(",
        *parts,
        '  nwr["amenity"~"^(pub|bar|biergarten|restaurant|cafe|nightclub|fast_food)$"](area.wien);',
        f'  nwr[~"^({lifecycle}):(amenity|name|leisure)$"~"."](area.wien);',
        ");",
        "out meta center;",
    ])


def fetch_overpass(bars: list[dict], refresh: bool, offline: bool) -> dict | None:
    """One Overpass query, cached. Stops on refusal (429) instead of retrying."""
    path = CACHE / "overpass.json"
    if path.exists() and not refresh:
        return load_json(path)
    if offline:
        return None
    query = overpass_query(bars)
    for attempt in range(2):
        log(f"querying Overpass (attempt {attempt + 1})")
        try:
            r = requests.post(OVERPASS_URL, data={"data": query}, headers=HEADERS, timeout=240)
        except requests.RequestException as e:
            log(f"Overpass error: {e}")
            r = None
        if r is not None and r.ok:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(r.content)
            return json.loads(r.content)
        if r is not None and r.status_code == 429:
            log("Overpass refused (429); not retrying")
            break
        time.sleep(60)
    save_json(CACHE / "overpass_failed.json", {"when": datetime.now(timezone.utc).isoformat()})
    return None


def osm_get(url: str) -> requests.Response | None:
    """One request to the OSM API, 1 s apart. Returns None if refused."""
    wait_for("api.openstreetmap.org")
    try:
        r = requests.get(url, headers=HEADERS, timeout=60)
    except requests.RequestException as e:
        log(f"OSM API error: {e}")
        return None
    if r.status_code in (429, 509):
        log(f"OSM API refused ({r.status_code}); stopping")
        return None
    return r


def fetch_history(missing: list[str], refresh: bool, offline: bool) -> dict[str, dict]:
    """Last visible version and deleting changeset for elements gone from OSM."""
    path = CACHE / "osm_history.json"
    cache = {} if refresh else (load_json(path) or {})
    todo = [m for m in missing if m not in cache][:MAX_HISTORY_REQUESTS]
    if todo and not offline:
        log(f"fetching OSM history of {len(todo)} elements")
        for bar_id in todo:
            r = osm_get(f"{OSM_API}/{bar_id[4:]}/history.json")
            if r is None:
                break
            if not r.ok:
                cache[bar_id] = {"status": r.status_code}
                continue
            versions = r.json().get("elements", [])
            last = versions[-1] if versions else {}
            visible = [v for v in versions if v.get("visible", True)]
            entry = {"status": 200, "deleted": last.get("visible") is False, "timestamp": last.get("timestamp"),
                     "changeset": last.get("changeset"), "last_tags": visible[-1].get("tags", {}) if visible else {}}
            if entry["deleted"] and entry["changeset"]:
                c = osm_get(f"{OSM_API}/changeset/{entry['changeset']}.json")
                if c is not None and c.ok:
                    entry["comment"] = c.json().get("changeset", c.json()).get("tags", {}).get("comment", "")
            cache[bar_id] = entry
        save_json(path, cache)
    return cache


CLOSED_WORDS = re.compile(
    r"geschlossen|zugesperrt|zu ?gesperrt|existiert (nicht|nicht mehr|nimmer)|gibt('?s| es) (das |den |die )?(nicht|nimmer)"
    r"|nicht mehr (da|vorhanden|existent|existiert|in betrieb|offen|geöffnet)|aufgelassen|leer ?stehend|leerstand"
    r"|abgerissen|ausgezogen|umgezogen|übersiedelt|\bclosed\b|shut down|no longer|doesn'?t exist|does not exist"
    r"|not exist|\bgone\b|disused|vacant|replaced by|ersetzt durch|pleite|insolven|not found on the ground", re.I)
RENAMED_WORDS = re.compile(r"umbenannt|neuer name|heißt (jetzt|nun)|now called|renamed|took its place|is now an? \b"
                           r"|ist jetzt (ein|eine)\b|jetzt (ein|eine)\b", re.I)
REOPENED = re.compile(r"neueröffnung|wiedereröffnung|wieder ?eröffnet|neu eröffnet|reopened|re-opened", re.I)
STILL_OPEN = re.compile(r"(noch|still|weiterhin|wieder) (offen|geöffnet|open|da|there|vorhanden|existiert|in betrieb)"
                        r"|existiert (noch|weiterhin)|exists|not closed|nicht geschlossen", re.I)
DOUBT = re.compile(r"(still|noch)\s+(exist|existiert|open|offen|geöffnet|da|there|vorhanden)|gibt es (das|den|die)? ?"
                   r"noch|existiert (das|der|die)? ?(lokal|gasthaus|restaurant|bar)? ?noch", re.I)
PRIVATE_ONLY = re.compile(r"nur (noch )?(für|bei) (private|geschlossene)|only (for )?private (events|parties)", re.I)


def closure_wording(text: str, renames: bool = True) -> str | None:
    """'closed', 'temporary', 'renamed' or None for free-text OSM fields and notes."""
    if REOPENED.search(text):
        return None
    if renames and RENAMED_WORDS.search(text):
        return "renamed"
    for m in CLOSED_WORDS.finditer(text):
        before = text[max(0, m.start() - 30):m.start()]
        if CLOSING_DAY.search(before + m.group(0)) or PART_OF_VENUE.search(before):
            continue
        if is_history(sentence_at(text, m.start(), m.end())):
            continue
        if re.search(r"vorr?übergehend|currently|derzeit|temporar|bis auf weiteres|umbau|renovier", text, re.I):
            return "temporary"
        return "closed"
    return None


def element_key(el: dict) -> str:
    return f"osm:{el['type']}/{el['id']}"


def lifecycle_keys(tags: dict) -> list[str]:
    return [k for k in tags if k.split(":")[0] in LIFECYCLE and k.split(":")[-1] in ("amenity", "leisure", "name")]


def osm_signals(bar: dict, old: dict | None, new: dict | None, hist: dict | None) -> list[Signal]:
    """Compare our extract with fresh OSM data for one bar."""
    if not bar["id"].startswith("osm:"):
        return []
    if new is None:
        if hist and hist.get("deleted"):
            day = (hist.get("timestamp") or "")[:10]
            return [Signal("osm_gone", "osm", 3, f"element deleted from OSM on {day}")]
        if hist is None:
            return []  # not checked (history request limit or refused)
        return [Signal("osm_gone", "osm", 3, "element no longer in OSM")]
    sigs: list[Signal] = []
    tags = new.get("tags", {})
    old_tags = (old or {}).get("tags", {})  # empty for bars matched outside the Overpass extract
    venue = tags.get("amenity") or tags.get("leisure")
    if lifecycle_keys(tags) and not venue:
        sigs.append(Signal("osm_gone", "osm", 3, "OSM now marks it disused/former"))
    elif lifecycle_keys(tags) or tags.get("disused") == "yes":
        sigs.append(Signal("osm_tag_closed", "osm", 3, "OSM tags it disused but keeps the amenity"))
    elif not venue and (old_tags.get("amenity") or old_tags.get("leisure")):
        other = next((f"{k}={tags[k]}" for k in ("shop", "office", "craft", "tourism") if k in tags), "")
        sigs.append(Signal("osm_gone", "osm", 3, f"OSM no longer tags it as a venue {other}".strip()))
    elif old_tags and tags.get("amenity") not in DRINK_AMENITIES | {None} and old_tags.get("amenity") != tags["amenity"]:
        sigs.append(Signal("osm_changed", "osm", 2, f"OSM now tags it amenity={tags['amenity']}"))
    if old_tags.get("name") and tags.get("name") and fuzz.ratio(normalize_name(old_tags["name"]),
                                                              normalize_name(tags["name"])) < 80:
        sigs.append(Signal("osm_renamed", "osm", 2, f"renamed in OSM to '{tags['name'][:30]}' since our extract"))
    hours = tags.get("opening_hours", "").strip().lower()
    if hours in ("closed", "off") or re.fullmatch(r'(closed|off)\s*"[^"]*"', hours):
        sigs.append(Signal("osm_tag_closed", "osm", 2, "OSM opening_hours says closed"))
    for key in ("note", "note:de", "fixme", "FIXME", "description", "description:de", "opening_hours"):
        val = tags.get(key, "")
        if not val:
            continue
        if PRIVATE_ONLY.search(val):
            sigs.append(Signal("osm_tag_private", "osm", 2, f"OSM {key.lower()} says private events only"))
        elif key.lower() == "fixme" and DOUBT.search(val):
            sigs.append(Signal("osm_doubt", "osm", 1, "OSM fixme asks whether it still exists"))
        elif key != "opening_hours":
            kind = closure_wording(val, renames=False)
            if kind == "closed":
                sigs.append(Signal("osm_tag_closed", "osm", 2, f"OSM {key.lower()} says it closed"))
            elif kind == "temporary":
                sigs.append(Signal("osm_tag_temporary", "osm", 1, f"OSM {key.lower()} says currently closed",
                                   temporary=True))
    return sigs


def lifecycle_neighbours(bars: list[dict], elements: list[dict]) -> dict[str, list[Signal]]:
    """Separate disused/was objects with the bar's name within 60 m: OSM has both.
    A twin edited after the bar is a medium sign, an older one (the bar may have reopened) a weak one."""
    out: dict[str, list[Signal]] = {}
    ours = {element_key(e): e for e in elements}
    ours = {b["id"]: ours.get(b["id"], {}).get("timestamp", "") for b in bars}
    for el in elements:
        tags = el.get("tags", {})
        keys = lifecycle_keys(tags)
        if not keys or element_key(el) in ours:
            continue
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lon = el.get("lon") or el.get("center", {}).get("lon")
        if lat is None:
            continue
        names = [tags[k] for k in tags if k == "name" or k.endswith(":name") or k == "old_name"]
        for b in bars:
            if abs(b["lat"] - lat) > 0.001 or distance_m(b["lat"], b["lon"], lat, lon) > NOTE_RADIUS_M:
                continue
            if any(fuzz.token_set_ratio(normalize_name(n), normalize_name(b["name"])) >= 85 for n in names):
                newer = el.get("timestamp", "") > ours[b["id"]]
                out.setdefault(b["id"], []).append(Signal(
                    "osm_disused_twin", "osm", 2 if newer else 1,
                    f"OSM also has a{' newer' if newer else 'n older'} disused object with this name"))
    return out


# --- OSM Notes --------------------------------------------------------------------------

def fetch_notes(refresh: bool, offline: bool) -> list[dict] | None:
    """Open notes and notes closed in the last ~2 years, in 2x2 bbox tiles over Vienna."""
    path = CACHE / "notes.json"
    if path.exists() and not refresh:
        return load_json(path)
    if offline:
        return None
    minlon, minlat, maxlon, maxlat = BBOX
    notes: dict[int, dict] = {}
    for i in range(2):
        for j in range(2):
            lon0 = minlon + i * (maxlon - minlon) / 2
            lat0 = minlat + j * (maxlat - minlat) / 2
            bbox = f"{lon0:.4f},{lat0:.4f},{lon0 + (maxlon - minlon) / 2:.4f},{lat0 + (maxlat - minlat) / 2:.4f}"
            log(f"fetching OSM notes, tile {bbox}")
            r = osm_get(f"{OSM_API}/notes.json?bbox={bbox}&limit=10000&closed={NOTES_DAYS}")
            if r is None or not r.ok:
                log("notes request failed; stopping")
                return None
            feats = r.json().get("features", [])
            if len(feats) >= 10000:
                log(f"tile {bbox} hit the 10,000 note limit; some notes are missing")
            for f in feats:
                notes[f["properties"]["id"]] = f
    data = list(notes.values())
    save_json(path, data)
    return data


ELEMENT_URL = re.compile(r"(?:openstreetmap\.org|osm\.org)/(node|way|relation)/(\d+)")


POI_NAME = re.compile(r"POI name:\s*(.+?)\s*(?:\n|POI types|#|$)")
VENUE_WORD = re.compile(r"\bbar\b|\bpub\b|lokal|beisl|gasthaus|gasthof|wirtshaus|\bwirt\b|caf[eé]|restaurant|heurig"
                        r"|kneipe|tschocherl|espresso|stüberl|schenke", re.I)
QUOTED = re.compile(r"[\"„“”']([^\"„“”']{3,40})[\"„“”']")


def note_subject(opening: str) -> tuple[set[str], str | None, bool]:
    """What a note is about: linked elements (StreetComplete), the POI name (Organic Maps/CoMaps),
    and whether it is about an unnamed POI."""
    linked = {f"osm:{t}/{n}" for t, n in ELEMENT_URL.findall(opening)}
    m = POI_NAME.search(opening)
    return linked, (m.group(1) if m else None), "POI has no name" in opening


def note_signals(bars: list[dict], notes: list[dict], edited: dict[str, str]) -> dict[str, list[Signal]]:
    """Closure reports in OSM notes. A note counts for a bar if it links the bar's element, names it,
    or (only while still open) lies within 60 m without naming anything else. A resolved note no
    longer counts once the bar's element was edited after it: the mapper has dealt with it."""
    out: dict[str, list[Signal]] = {}
    for f in notes:
        props = f["properties"]
        comments = props.get("comments", [])
        opening = comments[0].get("text", "") if comments else ""
        text = " ".join(c.get("text", "") for c in comments)
        kind = closure_wording(opening) or closure_wording(text)
        if not kind or STILL_OPEN.search(" ".join(c.get("text", "") for c in comments[1:])):
            continue
        linked, poi, unnamed_poi = note_subject(opening)
        lon, lat = f["geometry"]["coordinates"]
        created = props.get("date_created", "")[:10]
        is_open = props.get("status") == "open"
        for b in bars:
            if b["id"] not in linked and (abs(b["lat"] - lat) > 0.001
                                          or distance_m(b["lat"], b["lon"], lat, lon) > NOTE_RADIUS_M):
                continue
            if linked:
                named = b["id"] in linked
                if not named:
                    continue
            elif poi:
                named = fuzz.token_set_ratio(normalize_name(poi), normalize_name(b["name"])) >= 85 \
                    or bool(mentions_name(b["name"], poi))
                if not named:
                    continue
            elif unnamed_poi:
                continue
            else:
                named = bool(mentions_name(b["name"], text)) or \
                    fuzz.partial_ratio(normalize_name(b["name"]), normalize_name(opening)) >= 90
            if not is_open and edited.get(b["id"], "")[:10] >= created:
                continue
            # Unnamed: only open notes about a drinking place that name no other venue.
            if not named and (not is_open or not VENUE_WORD.search(opening) or QUOTED.search(opening)):
                continue
            temp = kind == "temporary"
            state = "open" if is_open else "resolved"
            what = {"temporary": "temporarily closed", "renamed": "replaced or renamed"}.get(kind, "closed")
            if named:
                sig = Signal("note_named", "note", 1 if temp else 2,
                             f"OSM note #{props['id']} ({created[:7]}, {state}) reports it {what}", temporary=temp)
            else:
                dist = round(distance_m(b["lat"], b["lon"], lat, lon))
                sig = Signal("note_nearby", "note", 2 if dist <= 15 and not temp else 1,
                             f"open OSM note #{props['id']} {dist} m away reports a closed bar", temporary=temp)
            out.setdefault(b["id"], []).append(sig)
    return out


# --- Combine ----------------------------------------------------------------------------

def assess(bar: dict, sigs: list[Signal], osm_open: bool) -> tuple[str, str] | None:
    """(confidence, suggested_action), or None if nothing points to a closure."""
    real = [s for s in sigs if s.strength > 0]
    if not real:
        return None
    best = {src: max((s.strength for s in real if s.source == src), default=0) for src in ("web", "osm", "note")}
    lasting = [s for s in real if not s.temporary]
    total = sum(best.values())
    if not lasting:
        return "low", "temporarily closed"
    strongest = max(s.strength for s in lasting)
    if strongest >= 3 or total >= 4:
        confidence = "high"
    elif total >= 2:
        confidence = "medium"
    else:
        confidence = "low"
    # The bar's own, working website without any closure sign speaks against OSM-only or note-only signs.
    if best["web"] == 0 and any(s.code == "web_active" for s in sigs) and not any(s.code == "osm_gone" for s in sigs):
        confidence = {"high": "medium", "medium": "low"}.get(confidence, confidence)
    osm_says_closed = any(s.code in ("osm_tag_closed", "osm_tag_private", "osm_disused_twin") and s.strength >= 2
                          for s in real)
    if confidence == "high":
        action = "fix in OSM" if osm_open and bar["id"].startswith("osm:") else "hide"
    elif osm_says_closed:
        action = "fix in OSM"
    else:
        action = "check by hand"
    return confidence, action


def evidence_text(sigs: list[Signal]) -> str:
    """Two strongest distinct pieces of evidence, short."""
    seen, parts = set(), []
    for s in sorted(sigs, key=lambda s: (-s.strength, s.temporary)):
        if s.strength == 0 or s.evidence in seen:
            continue
        seen.add(s.evidence)
        parts.append(s.evidence)
    parts = parts[:2]
    if any(s.code == "web_active" for s in sigs) and not any(s.source == "web" and s.strength > 0 for s in sigs):
        parts = parts[:1] + ["own website still looks active"]
    text = "; ".join(parts)
    return text[0].upper() + text[1:] if text else ""


# --- Main -------------------------------------------------------------------------------

def load_bars() -> list[dict]:
    hidden = {k for k, v in load_overrides().items() if v.get("hidden") == "1"}
    bars = json.loads((PUBLIC_DATA / "bars.json").read_text(encoding="utf-8"))
    return [b for b in bars if b["id"] not in hidden]


def fetch_status() -> dict[str, str]:
    path = INTERIM / "website_fetch.csv"
    with open(path, encoding="utf-8") as f:
        return {r["id"]: r["status"] for r in csv.DictReader(f)}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--refresh", nargs="*", choices=["overpass", "notes", "web", "history"],
                    help="fetch these sources again (all if no name is given)")
    ap.add_argument("--offline", action="store_true", help="never use the network, cached results only")
    args = ap.parse_args()
    refresh = set(args.refresh or []) if args.refresh is not None else set()
    if args.refresh == []:
        refresh = {"overpass", "notes", "web", "history"}
    CACHE.mkdir(parents=True, exist_ok=True)

    bars = load_bars()
    log(f"{len(bars)} published bars")
    status = fetch_status()
    signals: dict[str, list[Signal]] = {b["id"]: [] for b in bars}

    # 1. Cached website text
    suspicious: dict[str, str] = {}
    for b in bars:
        site = b.get("website") or ""
        sigs = content_signals(b, cached_segments(b["id"]), site)
        signals[b["id"]] += sigs
        if site and not SOCIAL.search(site):
            failed = status.get(b["id"], "missing") not in ("ok", "cached", "social")
            odd = any(s.code in ("web_parked", "web_placeholder", "web_takeover", "web_other_business") for s in sigs)
            if failed or odd or not cached_segments(b["id"]):
                suspicious[b["id"]] = site
    log(f"website text: {sum(1 for s in signals.values() if s)} bars with signs; {len(suspicious)} sites to re-check")

    # 2. Re-check failed or suspicious websites now
    rechecks = recheck_websites(suspicious, "web" in refresh, args.offline)
    by_id = {b["id"]: b for b in bars}
    for bar_id, res in rechecks.items():
        bar = by_id[bar_id]
        if res.get("text") is not None:
            # The site answers now: its home page replaces the cached one, cached subpages stay.
            home = (res["final_url"], (res.get("title", "") + " " + res["text"]).strip())
            web = content_signals(bar, [home] + cached_segments(bar_id)[1:], res["url"])
            signals[bar_id] = [s for s in signals[bar_id] if s.source != "web"] + web
        else:
            have = {s.code for s in signals[bar_id]}
            signals[bar_id] += [s for s in recheck_signals(bar, res) if s.code not in have]
    for b in bars:
        if any(s.source == "web" and s.strength > 0 for s in signals[b["id"]]):
            continue
        res = rechecks.get(b["id"], {})
        pages = ([(res["final_url"], res["text"])] if res.get("text") else []) or cached_segments(b["id"])[:1]
        same_site = pages and site_domain(pages[0][0]) == site_domain(b.get("website") or pages[0][0])
        if same_site and mentions_name(b["name"], pages[0][1], urlparse(pages[0][0]).netloc, b.get("website") or ""):
            signals[b["id"]].append(Signal("web_active", "web", 0, "own website still looks active"))
    web_counts = Counter(r.get("result") if r.get("result") != "http" else f"http {r.get('status')}"
                         for r in rechecks.values())
    log(f"re-check results: {dict(web_counts)}")

    # 3. OSM now
    old = {element_key(e): e for e in json.loads((RAW / "overpass_bars.json").read_text())["elements"]}
    old_stamp = json.loads((RAW / "overpass_bars.json").read_text())["osm3s"]["timestamp_osm_base"]
    fresh = fetch_overpass(bars, "overpass" in refresh, args.offline)
    osm_stamp, osm_open = None, {}
    if fresh:
        osm_stamp = fresh["osm3s"]["timestamp_osm_base"]
        new = {element_key(e): e for e in fresh["elements"]}
        missing = [b["id"] for b in bars if b["id"].startswith("osm:") and b["id"] not in new]
        log(f"Overpass data as of {osm_stamp}: {len(fresh['elements'])} elements, {len(missing)} of our bars missing")
        hist = fetch_history(missing, "history" in refresh, args.offline) if missing else {}
        for b in bars:
            sigs = osm_signals(b, old.get(b["id"]), new.get(b["id"]), hist.get(b["id"]))
            signals[b["id"]] += sigs
            osm_open[b["id"]] = b["id"] in new and not any(s.code == "osm_gone" for s in sigs)
        for bar_id, sigs in lifecycle_neighbours(bars, fresh["elements"]).items():
            signals[bar_id] += sigs
    else:
        log("no fresh OSM data")

    # 4. OSM notes
    notes = fetch_notes("notes" in refresh, args.offline)
    if notes is not None:
        log(f"{len(notes)} OSM notes in the Vienna bbox")
        edited = {element_key(e): e.get("timestamp", "") for e in fresh["elements"]} if fresh else {}
        for bar_id, sigs in note_signals(bars, notes, edited).items():
            signals[bar_id] += sigs

    rows, hacked = [], []
    for b in bars:
        sigs = signals[b["id"]]
        if any(s.code == "web_hacked" for s in sigs):
            hacked.append(b)
        verdict = assess(b, sigs, osm_open.get(b["id"], True))
        if not verdict:
            continue
        rows.append({"bar_id": b["id"], "name": b["name"], "district": b["district"],
                     "signals": ";".join(dict.fromkeys(s.code for s in sigs if s.strength > 0)),
                     "evidence": evidence_text(sigs), "confidence": verdict[0], "suggested_action": verdict[1]})
    order = {"high": 0, "medium": 1, "low": 2}
    rows.sort(key=lambda r: (order[r["confidence"]], r["district"], r["name"]))
    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["bar_id", "name", "district", "signals", "evidence", "confidence",
                                          "suggested_action"])
        w.writeheader()
        w.writerows(rows)
    log(f"wrote {OUT_CSV.relative_to(INTERIM.parent.parent)}: {dict(Counter(r['confidence'] for r in rows))}")

    takeovers = [b for b in bars if any(s.code in ("web_takeover", "web_parked") for s in signals[b["id"]])]
    social = sum(1 for b in bars if b.get("website") and SOCIAL.search(b["website"]))
    write_report(rows, signals, hacked, takeovers, {
        "bars": len(bars), "texts": sum(1 for b in bars if cached_segments(b["id"])),
        "with_site": sum(1 for b in bars if b.get("website")), "social": social,
        "rechecked": len(rechecks), "web_counts": web_counts, "old_stamp": old_stamp, "osm_stamp": osm_stamp,
        "notes": None if notes is None else len(notes),
        "unchecked_sites": sorted(f"{by_id[i]['name']} ({by_id[i]['district']}.)" for i, r in rechecks.items()
                                  if r.get("result") in ("robots", "social") or
                                  (r.get("result") == "http" and r.get("status") not in (200, 404, 410))),
    })


# --- Report -----------------------------------------------------------------------------

REVIEW_HEADING = "## Reviewer notes"


def md_table(rows: list[dict], cols: list[tuple[str, str]]) -> list[str]:
    out = ["| " + " | ".join(h for h, _ in cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(r[k]).replace("|", "/") for _, k in cols) + " |")
    return out


def osm_fix_hint(sigs: list[Signal]) -> str | None:
    """What to change in OSM, if OSM still shows the bar as open or contradicts itself."""
    codes = {s.code: s for s in sigs if s.strength > 0}
    if "osm_gone" in codes:
        return None
    if "osm_tag_closed" in codes and "disused" in codes["osm_tag_closed"].evidence:
        return "has amenity plus disused=yes, which our import keeps; retag as disused:amenity"
    if "osm_tag_closed" in codes and "opening_hours" in codes["osm_tag_closed"].evidence:
        if any(s.code == "web_active" for s in sigs):
            return "opening_hours=closed although its own website looks active; check and fix hours or retag"
        return "opening_hours=closed but still a venue; if gone for good, retag as disused:amenity"
    if "osm_tag_closed" in codes:
        return "an OSM note/description says closed but it is still a venue; retag or remove the remark"
    if "osm_tag_private" in codes:
        return "says private events only; remove the amenity or add access=private"
    if "osm_disused_twin" in codes and codes["osm_disused_twin"].strength >= 2:
        return "a newer disused object with the same name sits next to it; keep only one"
    if "web_changed" in codes:
        return "website says a new operator took over; after checking, rename or retag it"
    return None


def write_report(rows: list[dict], signals: dict[str, list[Signal]], hacked: list[dict], takeovers: list[dict],
                 info: dict) -> None:
    counts = Counter(r["confidence"] for r in rows)
    actions = Counter(r["suggested_action"] for r in rows)
    cols = [("Bezirk", "district"), ("Lokal", "name"), ("Evidence", "evidence"), ("Suggested action", "suggested_action")]
    wc = info["web_counts"]
    dead = sum(v for k, v in wc.items() if k in ("dns", "connection", "timeout")) + wc.get("http 404", 0) + wc.get("http 410", 0)
    low = [r for r in rows if r["confidence"] == "low"]
    low_temp = [r for r in low if r["suggested_action"] == "temporarily closed"]
    low_dead = [r for r in low if r["signals"] == "web_dead"]
    low_other = [r for r in low if r not in low_temp and r not in low_dead]
    same_day = info["osm_stamp"] and info["osm_stamp"][:10] == info["old_stamp"][:10]
    lines = [
        "# Closure check: bars that have probably closed",
        "",
        f"Written {date.today().isoformat()} by `pipeline/closure_check.py` (re-run it to update this file; the "
        "reviewer notes at the end are kept). All candidates with their signals: "
        "`data/interim/closure_candidates.csv`. Nothing was hidden or changed in the data.",
        "",
        "## What was checked",
        "",
        f"- **{info['bars']} published bars** (hidden ones in `overrides.csv` skipped).",
        f"- **Website text** that step 04 cached for {info['texts']} bars: wording for a permanent closure, farewell, "
        "handover or new name; parked or for-sale domains; casino takeovers; sites about another business. "
        "Closing days, holidays, scheduled closures, terrace or kitchen closures and venue history are ignored.",
        f"- **Websites re-checked today** ({info['rechecked']}): those that failed in step 04 or looked odd. Same rules "
        "as step 04: robots.txt, at least 1 s per domain, generic client name, home page only, no social media. "
        f"{dead} are dead (domain gone, refused, no answer, or 404/410).",
        f"- **OpenStreetMap today**: one Overpass query (our bar ids, plus food/drink venues and disused/was objects in "
        f"Vienna), data as of **{info['osm_stamp'] or 'not available'}**, compared with our extract of "
        f"**{info['old_stamp']}** that the published data is built from"
        + (" (only a day older, so few OSM changes were expected)" if not same_day else "") + ". Checked: deleted "
        "elements, lifecycle tags (disused:, was:, ...), lost amenity, renames, opening_hours=closed/off and "
        "note/fixme/description wording, and disused objects with the same name next to a bar.",
        f"- **OSM Notes**: {info['notes'] if info['notes'] is not None else 'not available'} notes in the Vienna bbox "
        f"(open, plus closed in the last {NOTES_DAYS // 365} years), 4 requests. A note counts if it links the bar's "
        f"element, names it, or (only while open) lies within {NOTE_RADIUS_M} m and names no other place. Resolved "
        "notes no longer count once the bar's element was edited afterwards.",
        "",
        "**Confidence.** High: the bar's own website or OSM says it closed, or two independent sources agree. "
        "Medium: one fairly clear sign (lost domain, OSM note about the bar, OSM tag saying closed). Low: one weak "
        "sign (dead website, nearby note, temporary closure). A dead website alone is weak, many Beisln let their "
        "site lapse. A working own website without closure signs lowers OSM- or note-only findings by one level.",
        "",
        "**Suggested action.** *hide*: add `hidden=1` in `overrides.csv`. *fix in OSM*: OSM still shows the bar as "
        "open (or contradicts itself); correct it there, as SPEC prefers, and it drops out at the next import "
        "(add `hidden=1` meanwhile if it should go now). *check by hand*: look before doing anything. "
        "*temporarily closed*: nothing to do yet.",
        "",
        f"## Result: {len(rows)} candidates",
        "",
        f"- high: {counts.get('high', 0)}",
        f"- medium: {counts.get('medium', 0)}",
        f"- low: {counts.get('low', 0)} ({len(low_dead)} only a dead website, {len(low_temp)} temporarily closed)",
        "",
        "## High confidence",
        "",
        *md_table([r for r in rows if r["confidence"] == "high"], cols),
        "",
        "## Medium confidence",
        "",
        *md_table([r for r in rows if r["confidence"] == "medium"], cols),
        "",
        "## Low confidence",
        "",
        "Temporarily closed: " + (", ".join(f"{r['name']} ({r['district']}.)" for r in low_temp) or "none") + ".",
        "",
        "Other weak signs:",
        "",
        *[f"- {r['name']} ({r['district']}.): {r['evidence']}" for r in low_other],
        "",
        f"Only a dead website ({len(low_dead)}): " + ", ".join(f"{r['name']} ({r['district']}.)" for r in low_dead) + ".",
        "",
        "## Fix in OSM",
        "",
        "OSM still shows these as open venues. Edit only with a reliable source (a visit, or the venue's own "
        "announcement); don't copy from Google.",
        "",
    ]
    for r in rows:
        hint = osm_fix_hint(signals[r["bar_id"]])
        if r["suggested_action"] == "fix in OSM" or hint:
            hint = hint or "still a venue in OSM; if confirmed, retag as disused:amenity or remove"
            lines.append(f"- {r['name']} ({r['district']}.), `{r['bar_id']}`: {hint}")
    if takeovers:
        lines += ["", "## Websites now owned by someone else", "",
                  "These links lead to casino, betting, parking or domain-sale pages. Whether or not the bar still "
                  "runs, the `website` tag in OSM is wrong and should be removed or replaced there; until then the "
                  "site links to spam.", "",
                  ", ".join(f"{b['name']} ({b['district']}.)" for b in sorted(takeovers, key=lambda b: b["district"]))
                  + "."]
    if hacked:
        lines += ["", "## Hacked websites (bar content still there)", "",
                  "Casino spam injected into the bar's own site. Not a closure sign, but the link is unpleasant: "
                  + ", ".join(f"{b['name']} ({b['district']}.)" for b in sorted(hacked, key=lambda b: b["district"]))
                  + "."]
    lines += ["", "## What could not be checked", "",
              f"- {info['bars'] - info['with_site']} bars have no website: only OSM and notes were checked for them.",
              f"- {info['social']} bars only link a social media page, which we don't fetch.",
              f"- {len(info['unchecked_sites'])} websites refused or failed the re-check (robots.txt, 403, 429, 5xx); "
              "not counted either way: " + ", ".join(info["unchecked_sites"]) + ".",
              "- Google Maps, Reddit and social media were not used, as agreed."]
    old = OUT_MD.read_text(encoding="utf-8") if OUT_MD.exists() else ""
    review = old[old.index(REVIEW_HEADING):].rstrip() if REVIEW_HEADING in old else ""
    OUT_MD.write_text("\n".join(lines) + "\n" + ("\n" + review + "\n" if review else ""), encoding="utf-8")
    log(f"wrote {OUT_MD.relative_to(REPORTS.parent)}")


if __name__ == "__main__":
    main()
