# Seidl-Tour-Planer: implementation spec

Working title. A desktop website for planning a Vienna "Seidl" tour: one small beer per district, using walking and public transport, with bars chosen to suit the group.

**How to use this spec:** build one phase at a time (section 14) and stop at each gate. Decisions in section 2 are made by the owner, so don't reopen them. Items marked *default* or *starting value* may be tuned. Items marked *unverified* must be checked before relying on them.

---

## 1. Goal and scope

The site must answer three questions better than Google Maps can:

1. Where should we start, and which bar there leads to a good tour?
2. From this bar, which next bars are close, well connected, and to our taste?
3. What does a complete, feasible tour look like?

### Core interaction

Clicking a bar shows its details and highlights recommended next bars on the map, based on travel time, fit with the rest of the tour, group preferences and similarity. Clicking only previews. "Zur Tour hinzufügen" commits.

### Out of scope for the first version

- Live transit data, delays or disruptions
- ~~Mobile layout~~ *Added by the owner on 2026-11-05: up to 900 px wide, a full-screen map with a bottom sheet (`Panel.tsx`, `PHONE` in `useMedia.ts`).*
- ~~Accounts, a backend or a database~~ *Added by the owner on 2026-11-09 for a group of friends: invite-code profiles, ratings, comments and lists through a Cloudflare Worker and D1 (`api/`). The planner itself stays static and works without it.*
- Bike, taxi or car routing
- Paid placement of any kind
- A general "where next?" bar guide (see section 8.4: keep it possible, don't build it)

---

## 2. Decisions

| Area | Decision |
|---|---|
| Audience | The owner and friends, but the site is open to anyone who finds it, with no password |
| Website | Desktop first, German interface, React + TypeScript, static, with a small optional API for friends' features |
| Planning modes | Chosen on the start screen: stop by stop, or a proposed full tour to adjust |
| Tour scope | One bar per district; all 23 by default, or a chosen subset |
| Days | One by default; optionally split into N days, each with its own start time and movable stops |
| Start | Pick a district and see its bars ranked, or let the tool suggest a district. No home address |
| End | Free by default, or an optional final district |
| Transport | Walking and public transport only |
| Travel times | Offline, computed from timetables as the median across departures. No live data |
| Time per stop | 20 minutes by default, adjustable |
| Bars | Everything suitable from OpenStreetMap (OSM). Any beer counts, so there's no draft check |
| Venue types | All count, each type can be filtered out: Bar & Pub (incl. beer gardens), Tschocherl & Café-Bar (Espresso, Stüberl, small drinking cafés), Beisl & Wirtshaus, Heuriger & Buschenschank, special venues (boulder gyms, bowling, hostel bars, music venues). Kaffeehäuser, Konditoreien and bakery cafés are not included. *Changed by the owner on 2026-11-03; was four types with cafés and Heurigen together.* |
| Official bars | Optional filter, off by default |
| Tags | Essen, Urig, Modern, Preiswert, Gehoben, Gastgarten, Lang offen, Live-Musik, Absteige |
| Tagging | Claude Code on the owner's plan, starting with 10-15 bars per district. Absteige mostly by hand |
| Preferences | One planner enters each participant's likes and avoids. "Avoid" ranks a bar lower and never removes it |
| Saving | Stored in the browser. A share link gives friends their own copy |
| Pipeline machine | 16 GB RAM or more |
| Deadline | None |

### Defaults (owner may still change these)

- **Walking or transit:** walk if it is at most 5 minutes slower than transit. Adjustable.
- **Travel-time window:** Saturday 10:00-22:00 first. Until other days are added, the chosen weekday affects opening hours only.
- **S-Bahn:** include it if data access works. If it doesn't, launch without it and say so on the site.
- **Untagged bars:** selectable, neutral on tags, shown as "noch nicht getaggt".
- **Manual tags:** a local-only edit mode that saves to the tag file. Friends' suggestions go through the owner.
- **Too many bars:** if the import is far above 1,000, narrow restaurants and cafés first.
- **Hosting:** Cloudflare Workers free plan: static assets, plus a Worker and D1 for `/api/*` only.
- **Plan defaults:** Saturday, start 11:00, walking speed 4.8 km/h.

---

## 3. Architecture

```text
OSM extract + GTFS feeds + district boundaries + own CSV files
        │  pipeline/ (Python + a small Node step), run occasionally
        ▼
public/data/bars.json, public/data/districts.geojson, public/data/manifest.json
public/data/travel/{walk,transit_p25,transit_p50,transit_p75}.bin
        ▼
web app: React + TypeScript + Vite + MapLibre + OpenFreeMap
        │  solver and scoring in a Web Worker, plan in localStorage
        ▼
Share link for the plan, Google Maps link for each leg
```

### Repository layout

```text
SPEC.md
pipeline/
  01_fetch_raw.py          download OSM extract, GTFS, boundaries (cached)
  02_import_bars.py        OSM to candidate bars, classification, dedupe
  03_match_official.py     match official CSVs to bars, add unmatched ones
  04_fetch_websites.py     fetch website text for tagging (cached, not published)
  05_opening_hours.mjs     parse opening_hours into weekly intervals
  06_travel_matrix.py      r5py matrices to .bin files
  07_build_site_data.py    merge everything into public/data/
  tests/
data/
  raw/                     gitignored
  own/
    official_2026-04.csv   provided with this spec
    extra_bars.csv         bars not in OSM (name, district, lat, lon, type)
    overrides.csv          district overrides, hidden bars
    tags.csv               own tags
    website_text/          gitignored, never published
reports/                   gate reports for the owner
src/
  domain/                  types, travel, scoring, solver, hours, plan encoding (no React)
  worker/                  Web Worker wrapper
  components/
public/data/
```

Keep `src/domain/` free of React and browser APIs so it can be tested alone and reused later.

---

## 4. Data sources

| Data | Source | Licence | Status |
|---|---|---|---|
| Streets, bars | OSM via [Geofabrik Austria extract](https://download.geofabrik.de/europe/austria-latest.osm.pbf), [Overpass](https://overpass-api.de/) | ODbL, attribution and share-alike | Not yet queried; bar count unknown |
| U-Bahn, tram, bus, Badner Bahn | [Wiener Linien GTFS on data.gv.at](https://www.data.gv.at/katalog/dataset/wiener-linien-fahrplandaten-gtfs-wien), also listed in the [Mobility Database](https://mobilitydatabase.org/feeds/gtfs/mdb-648) | CC BY | Listing shows Wiener Linien and Wiener Lokalbahnen only; not yet downloaded |
| S-Bahn | [ÖBB data platform](https://data.oebb.at/) or Mobilitätsverbünde Österreich (feed names seen: `Railway-Current-Reference-Data`, `PTA-Eastern-Region`) | Check terms | *Unverified*, may need registration. Eastern Region may duplicate Wiener Linien trips |
| District boundaries | Stadt Wien open data (`BEZIRKSGRENZEOGD` layer), fallback OSM boundaries (likely `admin_level=9`) | CC BY or ODbL | *Unverified* |
| Drawn routes (display only) | Walking: [FOSSGIS OSRM](https://routing.openstreetmap.de/); transit lines: [Transitous](https://transitous.org/api/) (MOTIS 2), fetched in the browser for tour legs only | ODbL / per-feed, see transitous.org/sources | Travel times still come from our matrices. Transitous asks for an open-source, non-commercial, low-volume client and contact info on the site |
| Map tiles | [OpenFreeMap](https://openfreemap.org/), style `https://tiles.openfreemap.org/styles/liberty` | Attribution required | No API key or usage limit |
| Official bars, April 2026 | [Booklet PDF](https://www.ottakringerbrauerei.at/de/wp-content/uploads/sites/6/2026/03/0226_OTK_Seidlwandertage_Gastro_Booklet_105x148mm_Innenseiten_v11_WEB.pdf), transcribed in `official_2026-04.csv` | Facts only; don't republish the descriptions | 51 venues transcribed |
| Official bars, October 2026 | [Vol. 4 PDF](https://www.ottakringerbrauerei.at/de/wp-content/uploads/sites/6/2026/08/ReiseBIERgleiter_Ottakringer-Seidlwandertage_Vol4_barrierefrei.pdf) | Same | Not readable when this spec was written. Press mentions seven additional partners. Add as `official_2026-10.csv` |

**Do not use Google's APIs.** Multi-stop transit isn't supported, a matrix would exceed the free tiers, and the terms restrict caching and use on non-Google maps. Link out to Google Maps instead.

---

## 5. Data pipeline

### 5.1 Raw data

Download once and cache in `data/raw/`. Clip the Austria extract to Vienna plus a margin, because some official bars sit just outside the city:

```text
osmium extract -b 16.15,48.09,16.61,48.35 austria-latest.osm.pbf -o vienna.osm.pbf
```

If `osmium-tool` is awkward on the owner's OS, use conda-forge or Docker.

### 5.2 Bar import

Query OSM once and cache the result. This query is a starting point and is *unverified*:

```text
[out:json][timeout:180];
area["name"="Wien"]["admin_level"="4"]->.wien;
(
  nwr["amenity"~"^(pub|bar|biergarten|restaurant|cafe)$"](area.wien);
  nwr["leisure"="bowling_alley"](area.wien);
);
out center tags;
```

Classify into `venue_type`:

| Type | Rule |
|---|---|
| `pub_bar` | `amenity` is `pub`, `bar` or `biergarten`, or a restaurant named Pub or Bar |
| `tschocherl` | `amenity=cafe` that is a drinking place: name with Espresso, Café-Bar, Stüberl, Eck, Treff and similar, late opening hours, or beer and drinks on its website. Also bars named Café or Espresso. Small cafés with no data are included by default |
| `beisl_wirtshaus` | `amenity=restaurant` whose first `cuisine` is Austrian-type, or whose name contains Gasthaus, Gasthof, Beisl, Wirtshaus, Stüberl, Bräu, Weinhaus or similar; untagged restaurants only with late opening hours or a Wirtshaus/beer website |
| `heuriger` | name or `cuisine` indicates a Heuriger or Buschenschank |
| `special` | `leisure=bowling_alley`, plus venues from the official list or `extra_bars.csv` that fit nothing above |

Excluded: Kaffeehäuser, Konditoreien, bakery and specialty-coffee cafés (by name, shop tag, cake/coffee cuisine, daytime-only hours, or a website about cake and coffee rather than drinks), and restaurants whose first cuisine is foreign (pizza, sushi, kebab and so on). *Owner decisions, 2026-11-03.*

Drop:
- Entries without a name, and anything with a `disused:` or `abandoned:` prefix
- Other restaurants, such as pizza or sushi, unless they're on an official list
- Coffee chains and bakery cafés, identified by the `brand` tag and a short exclusion list

Deduplicate entries with similar names less than 30 m apart. Assign districts by point-in-polygon, then apply `overrides.csv`. Never derive the district from the postcode alone: Karl-Wirt has a 2380 Perchtoldsdorf address but is listed under district 23.

**Use stable IDs:** `osm:node/123`, `osm:way/456`, or `own:<slug>` for bars from `extra_bars.csv`.

### 5.3 Official bars

Match each row to an OSM bar by name and address. Unmatched rows go into `extra_bars.csv` with coordinates checked by hand. Write unmatched and uncertain matches to a report. Bars carry `official: ["2026-04", ...]`, and the filter uses the newest edition.

Corrections for wrong OSM data should preferably be made in OSM itself, not in local overrides.

### 5.4 Website text

`04_fetch_websites.py` fetches each bar's website for tagging:
- Honour `robots.txt`, wait at least 1 second per domain, and use a generic client name without personal contact details
- Skip social media pages
- Keep plain text only, up to about 8,000 characters
- Store in `data/own/website_text/`, which is gitignored and never published

### 5.5 Tags

| Tag | Meaning | Main evidence |
|---|---|---|
| Essen | Warm food or a proper menu | OSM `amenity=restaurant`, `food`, `cuisine`; website |
| Urig | Traditional, grown over time, cosy, regulars | Website wording |
| Modern | Contemporary concept or interior | Website wording |
| Preiswert | Noticeably low prices | Menu prices or an explicit statement only |
| Gehoben | Higher price and service level | Menu prices or an explicit statement only |
| Gastgarten | Outdoor seating | OSM `outdoor_seating`, `beer_garden`; website |
| Lang offen | Closes at 01:00 or later on Friday or Saturday | Computed from opening hours |
| Live-Musik | Regular live music | OSM `live_music`; website |
| Absteige | Rough, no-frills drinking place | **By hand only** |

Rules:
- Preiswert and Gehoben exclude each other.
- A missing tag means unknown, not "no". Never guess.
- Every tag not computed needs a short paraphrased evidence note of 15 words or fewer. Don't copy text from websites or the booklet.
- Don't record checkable negative claims (illegal activity, hygiene problems and so on), including under Absteige. Tags are opinions.

`data/own/tags.csv`:

```csv
bar_id,tag,value,source,evidence,reviewed
osm:node/123,urig,1,claude,"Describes itself as a traditional Beisl with regulars",0
osm:way/456,absteige,1,manual,"Our opinion after a visit",1
```

`source` is `osm`, `claude`, `manual` or `computed`.

**Tagging stages:**
1. Up to 15 bars per district: official bars first, then bars with websites, preferring `pub_bar` and `gasthaus_beisl`.
2. Everything else, in further sessions.

**How to run tagging in Claude Code:**
- Confirm `ANTHROPIC_API_KEY` is not set, otherwise usage is billed to that key instead of the owner's plan.
- Work in batches of about 25 bars and append to `tags.csv` after each batch, so work can resume when plan limits are reached.
- Give the owner a sample of 20 bars to spot-check after the first batch, and adjust the tag definitions if needed before continuing.

**Local edit mode:** on the Vite dev server only (`import.meta.env.DEV`), the bar panel shows tag toggles that save to `data/own/tags.csv` through a small dev endpoint, marked `manual` and `reviewed=1`. This must not exist in the production build. It's the main way to set Absteige.

### 5.6 Opening hours

`05_opening_hours.mjs` uses the `opening_hours` npm package to turn each OSM `opening_hours` string into weekly intervals, stored in `bars.json`:

- Minutes from Monday 00:00, handling intervals that cross midnight
- `null` means unknown; `[]` means known closed all week
- Keep the original string for display
- Public holidays are ignored in the first version
- Booklet remarks in the CSV `notes` column can fill gaps by hand for official bars

### 5.7 Travel-time matrices

Use [r5py](https://r5py.readthedocs.io/stable/reference/reference.html). It needs JDK 21 or later (conda installs it, pip doesn't). The sketch below uses documented parameter names, but confirm details against the installed version.

```python
from datetime import datetime, timedelta
import r5py

net = r5py.TransportNetwork("data/raw/vienna.osm.pbf", ["data/raw/wienerlinien.gtfs.zip"])

common = dict(origins=bars, destinations=bars, snap_to_network=True,
              speed_walking=4.8, max_time=timedelta(hours=2))

transit = r5py.TravelTimeMatrix(
    net,
    departure=datetime(2026, 11, 14, 10, 0),       # a Saturday inside the feed's service dates
    departure_time_window=timedelta(hours=12),     # the default is only 10 minutes
    percentiles=[25, 50, 75],
    transport_modes=[r5py.TransportMode.TRANSIT, r5py.TransportMode.WALK],
    **common,
)
walk = r5py.TravelTimeMatrix(net, transport_modes=[r5py.TransportMode.WALK], **common)
```

Notes:
- **Check the feed's service dates before choosing the date.** The Mobility Database lists some 2026 releases with service dates ending before the release date. A date outside the feed returns no transit trips, which looks like a bug.
- r5py's default walking speed is 3.6 km/h, so set it explicitly.
- Times include waiting, because each departure minute is measured from when you leave.
- Output column names for several percentiles aren't documented on the page checked. Inspect the result.
- Allocate memory explicitly (r5py's `--max-memory` option), about 10-12 GB on a 16 GB machine.
- If a 12-hour window across all bars is too slow, compute several one-hour windows and combine them.

**Output format:** one file per matrix, `n × n` bytes, row-major, `Uint8`, in whole minutes. `255` means unreachable, and the diagonal is `0`. Row and column order come from `manifest.json`.

| Bars | Per matrix | All four |
|---|---|---|
| 345 | 119 KB | 476 KB |
| 1,000 | 1 MB | 4 MB |
| 2,000 | 4 MB | 16 MB |

Sizes are before the host's compression. The solver only needs `walk` and `transit_p50`. Load `p25` and `p75` after first render, for display.

---

## 6. Data model

```ts
type VenueType = "pub_bar" | "tschocherl" | "beisl_wirtshaus" | "heuriger" | "special";

type Tag = "essen" | "urig" | "modern" | "preiswert" | "gehoben"
         | "gastgarten" | "lang_offen" | "live_musik" | "absteige";

interface Bar {
  id: string;                     // "osm:node/123" or "own:slug"
  matrixIndex: number;
  name: string;
  district: number;               // 1-23
  lat: number;
  lon: number;
  venueType: VenueType;
  address?: string;
  website?: string;
  phone?: string;
  wheelchair?: string;            // raw OSM value
  openingHoursText?: string;
  weeklyOpen: [number, number][] | null;   // minutes from Monday 00:00; null = unknown
  official: string[];             // e.g. ["2026-04"]
  tags: Tag[];
  unreviewedTags: Tag[];          // subset of tags not yet checked by a person
  description?: string;           // own text only
}

interface Participant {
  name: string;
  likes: Tag[];
  avoids: Tag[];
}

interface DayPlan {
  startMinutes: number;           // minutes from midnight
  stops: string[];                // bar IDs in order
}

interface TourPlan {
  schema: 1;
  dataVersion: string;
  mode: "stepwise" | "full";
  weekday: number;                // 0 = Monday
  stopMinutes: number;            // default 20
  walkToleranceMinutes: number;   // default 5
  districts: number[];            // default all 23
  startDistrict: number | null;   // null = suggest
  endDistrict: number | null;     // null = free
  venueTypes: VenueType[];
  officialOnly: boolean;
  speedVsMatch: number;           // slider, 0..1
  similarity: "similar" | "different" | "ignore";
  participants: Participant[];
  excludedBars: string[];
  days: DayPlan[];
}
```

---

## 7. Travel logic

```ts
function leg(u: number, v: number, tolerance: number): Leg {
  const w = walk[u][v];
  const t = transitP50[u][v];
  if (w === 255 && t === 255) return unreachable;
  if (t === 255 || w <= t + tolerance) return { mode: "walk", minutes: w };
  return { mode: "transit", minutes: t, usually: [transitP25[u][v], transitP75[u][v]] };
}
```

Labels: "6 Min. zu Fuß", "12 Min. Öffis (meist 10-15)".

Each leg links to Google Maps for navigation, without an API key:

```text
https://www.google.com/maps/dir/?api=1&origin=LAT,LON&destination=LAT,LON&travelmode=walking|transit
```

Each bar links to its Google Maps page for reviews and photos:

```text
https://www.google.com/maps/search/?api=1&query=NAME%20ADDRESS
```

---

## 8. Recommendations

### 8.1 Filter

When a bar is clicked, candidates must:
- Be in an included district with no stop yet
- Match the venue-type and official filters, and not be excluded
- Not be known to be closed on arrival (unknown hours are allowed)

### 8.2 Score

All parts are in `0..1`, except `match`, which is in `-1..1`. All weights are *starting values*.

```text
score(v | u) = w1 × closeness + w2 × tourFit + w3 × match + w4 × similarity

closeness  = 1 − min(leg(u, v), 45) / 45
tourFit    = 1 − min(extra, 30) / 30      extra = best remaining tour via v − best remaining tour overall
match      = mean over participants of clamp((likesHit − 1.5 × avoidsHit) / max(1, likes + avoids), −1, 1)
similarity = Jaccard(tags(u), tags(v)), or 1 − Jaccard for "etwas anderes"

w1 = 0.40, w2 = 0.30, w3 = 0.20, w4 = 0.10
```

- Untagged bars have `match = 0`.
- The "Schneller ↔ Passender" slider moves weight between `w1 + w2` and `w3`.
- `similarity` ignored: set `w4 = 0`.
- Each result carries its reasons, for the label, e.g. "6 Min. zu Fuß · Urig · +1 Min."
- Also show how many planned stops match each participant, so nobody gets ignored.

### 8.3 Two stages

1. **Instant:** score everything with `tourFit = 0.5` and update the map at once.
2. **Refine:** in the worker, compute `tourFit` for the top 20 and reorder as results arrive. Cancel the job if another bar is clicked.

### 8.4 Keep it reusable

`recommend(bar, constraints, preferences)` must be a standalone function in `src/domain/`, with the one-bar-per-district rule passed in as a constraint. A later bar guide then reuses it by dropping that rule. Don't add any boost, sponsorship or payment field to the score. If paid placement ever comes, it would be a separate, clearly labelled slot.

---

## 9. Solver

This is a generalized travelling salesman problem with open ends: one bar per district, in any order.

```text
objective = Σ leg minutes + Σ closedPenalty(v, arrival) − λ × Σ match(v)
```

*Starting values:* `closedPenalty` = 90 per stop known to be closed on arrival, `λ` = 5 minutes per 1.0 of match, adjustable through the slider (`λ = 10 × slider`). Penalties rather than hard rules mean a tour always exists, with warnings where needed.

**Method:**
1. **Candidates:** for each district, apply the filters and keep `K` bars (default 15, maximum 30). Take half by `match`, and the other half spread across the district so the choice isn't clustered. *Tuned 2026-11-04:* without preferences, a quarter by richness (tips, official, tags), a quarter by connectivity (sum of the two shortest legs to other districts), the rest spread. Bars known to be closed for the whole day window are dropped. This cut a 23-district tour from 234 to 203 travel minutes at K = 15.
2. **Inner step:** for a fixed district order, a layered dynamic programme picks the best bar per district. Track the arrival time along the best path to each bar, for opening hours. This makes it a heuristic, which is fine here.
3. **Outer step:** multi-start local search over the district order, using Or-opt and 2-opt moves with first improvement. Use a seeded random generator so tests are repeatable.
4. **No straight back** *(added 2026-11-04, on by default, switch in the plan dialog)*: two transit legs in a row that turn by more than about 135° add 30 minutes, so tours don't ride out one line for a single stop and straight back. The matrices have no line names, so this is geometric; the timeline also warns when Transitous shows the same line both ways.
5. **Polish** *(added 2026-11-04)*: try every eligible bar of each free stop's district in place and keep improvements, since the search only sees K candidates.

Measured on the real data (2,140 bars, 23 districts, Node 22): one solve 0.6-0.8 s, three proposals without a start 3.5-4.7 s, refining 20 recommendations 2.3 s.

**Constraints to support:**
- Fixed prefix (stops already chosen)
- Fixed first bar or first district
- Optional fixed last district
- Pinned and excluded bars
- A subset of districts

**Features built on it:**
- **Rank start bars:** solve once per candidate in the chosen district, then rank by total and show "+N Min." against the best.
- **Suggest a start district:** solve from each included district and highlight the best three.
- **"Tour für mich fertig planen":** keep the fixed prefix and solve the rest. Any stop can then be swapped.
- **Split into N days:** cut the route to minimise the longest day, then recheck opening hours using each day's start time. Stops can be dragged between days. The first stop of a day has no incoming leg.

**Reference performance** from a test with 345 made-up bars (15 per district), invented travel times, 3 datasets, in unoptimised single-threaded JavaScript under Node:

| Task | Result |
|---|---|
| Solve, 3 restarts | 0.4-0.8 s, within 1% of the best of 40 restarts |
| Rank 15 start bars | About 5 s |
| Rank 20 next stops | 3.5-4 s |
| Nearest-bar greedy | 22-31% longer than the best found |

Never rank next stops by distance alone. Run all solving in a Web Worker, and show results as they arrive.

---

## 10. Interface

German throughout. Use sentence case. Label bars by name, and never show internal IDs.

### 10.1 Start screen

Heading: "Wie möchtet ihr planen?"

Two choices:
- **Schritt für Schritt:** "Klickt euch von Lokal zu Lokal, mit Vorschlägen auf der Karte."
- **Komplette Tour vorschlagen:** "Ihr bekommt sofort eine ganze Route und tauscht einzelne Lokale."

Settings, all with defaults so people can start immediately:
- Wochentag (Samstag), Startzeit (11:00), Aufenthalt pro Lokal (20 Min.), Tage (1)
- Bezirke (alle 23), Startbezirk (Vorschlagen), Letzter Bezirk (Egal)
- Lokaltypen (alle), Nur offizielle Partnerlokale (aus)
- Teilnehmer:innen: name plus "mag" and "lieber nicht" per tag (optional)

*Changed 2026-11-04 (owner):* the map filter (top left: venue types, "must have" tags, recommendation sources, open at a time) only changes what is shown and what recommendation and swap lists offer. Everything the planner uses (day, start, stay, districts, first and last district, walking preference, venue types for planning, preferences, taste quiz) lives in the "Tour planen" dialog. A tour is a list of slots, one per district, which may be empty ("Leere Vorlage"); slots can be reordered by drag and drop, cleared (place kept) or deleted.

### 10.2 Planner

Map on the left, about two-thirds of the width. Panel on the right with three parts:

1. **Selected bar:** name, Bezirk, type, address, opening hours or "Öffnungszeiten unbekannt", tags, website, "In Google Maps ansehen", and the primary button "Zur Tour hinzufügen". Show unreviewed tags in a muted style, with "noch nicht getaggt" if there are none.
2. **Empfohlen als Nächstes:** the top 5, each with number, name, Bezirk and reason line. Selecting one previews it. Add a "Ähnlich / Etwas anderes" switch and the "Schneller ↔ Passender" slider.
3. **Eure Tour:** timeline with arrival times, legs with Google Maps links, totals ("9 von 23 Bezirken · 5 h 40"), warnings ("Bei Ankunft geschlossen"), and "Tour für mich fertig planen".

### 10.3 Map

| Element | Display |
|---|---|
| Other bars | Small grey dots |
| Selected bar | Large marker with a ring |
| Tour so far | Solid line with stop markers |
| Top 5 recommendations | Numbered markers with dashed lines from the selected bar |
| Next 15 recommendations | Medium markers, no number |
| Closed on arrival | Hollow marker |
| District with a stop | Tinted polygon |

Never use colour as the only signal: combine it with size, number or shape. Hovering shows name and reason line. Support light mode only in the first version.

### 10.4 Footer

Always visible: attribution and notices from section 12.

---

## 11. Saving and sharing

- Save `TourPlan` to `localStorage`, with reads and writes wrapped in `try/catch`. The site must work without it.
- Share link: compress the JSON (`lz-string`) into the URL hash. Opening a link creates the visitor's own copy, and there's no live sync.
- On load, compare `dataVersion`. Keep plans with unknown bar IDs, flag those stops, and offer to replace them.

---

## 12. Attribution and legal

The site is public, so before deployment:

- **Credits in the footer:** "© OpenStreetMap-Mitwirkende (ODbL)", "OpenFreeMap © OpenMapTiles", "Fahrplandaten: Wiener Linien (CC BY)", plus any S-Bahn and boundary sources used, and a link to transitous.org/sources for drawn transit routes.
- **Bar data:** `bars.json` contains OSM data and is public, so offer it under ODbL. Keep OSM and own data separate in the repository (each tag's `source`, `tags.csv`). The [OSM Foundation guideline](https://osmfoundation.org/wiki/Community_Guidelines/Collective_Database_Guideline_Guideline) treats own data as independent only if a property is entirely from OSM or entirely from elsewhere, and merging a private bar list into OSM data may bring it under share-alike. This matters mainly for any future commercial version.
- **Tags as opinion:** show "Tags sind subjektive Einschätzungen." plus a way to request a correction or removal, and act on requests.
- **Not official:** don't use the Ottakringer logo or branding. *The footer line "Kein offizielles Angebot der Ottakringer Brauerei." was removed by the owner on 2026-11-05.* Write own descriptions rather than copying the booklet.
- **Legal notice:** the owner must check whether Austrian law (§ 25 MedienG) requires a notice with name and place of residence for a private site. The source checked doesn't settle this. **Ask the owner before publishing personal details.**
- **Privacy:** no analytics or cookies in the first version. Check whether the host or font loading requires a privacy note.

This section is orientation, not legal advice.

---

## 13. Testing

**Pipeline (pytest):**
- `official_2026-04.csv` has 51 rows and at least one bar per district
- Postcode matches district, except Karl-Wirt
- Every bar has a district from 1 to 23 and valid coordinates
- Each matrix has `n²` bytes and a zero diagonal
- Every published bar has a matrix index
- No `website_text` in `public/`

**Domain (vitest):**
- A tour has exactly one bar per included district
- The dynamic programme matches brute force on small cases
- Local search never returns a worse tour than its start
- Fixed prefix and last district are respected
- `leg()` follows the walking tolerance and handles `255`
- "Avoid" lowers a bar's rank but never removes it
- Closed bars are penalised, while unknown hours aren't
- Day split keeps all stops in order
- Plan encoding round-trips through the share link

**End to end (Playwright, at 1440 × 900):**
- Click a bar: panel opens and 5 numbered markers appear
- "Zur Tour hinzufügen": timeline updates, and that district leaves the recommendations
- "Tour für mich fertig planen": all included districts are covered
- Reload restores the plan, and a share link recreates it
- Attribution is visible

---

## 14. Build phases

Stop at each gate and report to the owner.

### Phase 0: Set up
Scaffold the repository, Python environment with JDK 21+, Vite + React + TypeScript, and test runners. Put `official_2026-04.csv` in `data/own/`. Try to download the October 2026 booklet and add `official_2026-10.csv`; if it can't be read automatically, ask the owner to save the PDF.

### Phase 1: Routing test (about half a day)
Get coordinates for the official bars (match them to OSM, or use Nominatim at no more than 1 request per second, and cache the results). Build the network and compute all four matrices for them. Try to add S-Bahn data.

**Gate:** write `reports/routing_check.md` with run time, peak memory, and 20 sample legs (mix of short, long, cross-Danube and outer districts). The owner compares them with WienMobil or Google by hand. Pass if the median difference is at most 5 minutes. If it fails, investigate feed dates, S-Bahn coverage and snapping, then consider [MOTIS](https://github.com/motis-project/motis) as the fallback router.

### Phase 2: Bar import (about half a day)
Import, classify, deduplicate and assign districts.

**Gate:** write `reports/bars.md` with counts per district and type, how many have opening hours and websites, official-list match rate, and a random sample of 30 bars. The owner confirms the filters. If there are far more than 1,000 bars, propose narrowing. Warn about any district with fewer than 5 bars.

### Phase 3: Explore map (a weekend)
Map, district polygons, all bars, click panel, filters, and recommendations using `closeness`, `match` and `similarity`. Add the local tag edit mode. Run the full-bar matrices.

**Gate:** demo for the owner.

### Phase 4: Tagging, stage 1 (1-2 evenings, can run alongside Phase 3)
Fetch websites and tag up to 15 bars per district in batches. Compute Lang offen.

**Gate:** the owner spot-checks 20 bars after the first batch.

### Phase 5: Tour planner (a weekend)
Solver, both planning modes, timeline, opening-hours checks, start ranking, district suggestion, "Tour für mich fertig planen", `tourFit` refinement, and swapping stops.

**Gate:** plan a full tour both ways and check that the timeline is believable.

### Phase 6: Group and sharing
Participants, likes and avoids, per-person match counts, split into N days, saving and share link.

**Gate:** demo for the owner.

### Phase 7: Publish
Footer and notices from section 12, build, and deploy to the static host. Test the deployed site, including matrix loading.

**Gate:** owner decides on the legal notice, then publishes.

### Later
- Matrices for weekdays, Sundays and late night. U-Bahn night service differs by day, so check this against the feed.
- Line names per leg (`r5py.DetailedItineraries`)
- Bar photos via Mapillary street-level images (CC BY-SA, free access token on a Meta account). *Owner's choice 2026-11-04*; the owner checks Mapillary first and comes back to it. Rejected: Google photos (terms), Panoramax (no coverage at our bars), OSM/Wikimedia images (about 1-2 % of bars).
- Tagging stage 2
- Mobile layout
- General bar guide

---

## 15. Known unknowns

| Question | Answered in |
|---|---|
| How many suitable Vienna bars does OSM have, and how good are hours and websites? | Phase 2 |
| Is a 12-hour median window across all bars fast enough on 16 GB? | Phases 1 and 3 |
| Can S-Bahn data be obtained, and does it overlap with Wiener Linien? | Phase 1 |
| Are the district boundary source and Overpass query correct as written? | Phases 1 and 2 |
| Does the solver stay quick with real data, `K = 30` and opening hours? | Phase 5: yes for K = 15 (see section 9); K = 30 doubles the time for about 1.5% shorter tours |
| What share of bars have websites good enough for tagging? Price tags will likely have the most gaps | Phase 4 |
| Do Claude plan limits allow tagging at a useful pace? | Phase 4 |

Package names (`maplibre-gl`, `react-map-gl`, `lz-string`, `opening_hours`) and versions weren't checked against the registries while writing this spec. Confirm them on install.

---

## 16. First prompt for Claude Code

```text
Read SPEC.md and data/own/official_2026-04.csv. Implement Phase 0 and Phase 1 only.

Don't reopen the decisions in section 2. Check anything marked unverified before relying on it.
Don't use the Anthropic API. If ANTHROPIC_API_KEY is set, tell me before doing any tagging.

Stop at the Phase 1 gate. Show me reports/routing_check.md and the 20 legs to compare by hand.
Ask me only if you're blocked, for example if a data source needs my registration.
```
