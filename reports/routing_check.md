# Routing check (Phase 1 gate)

Generated 2026-11-03T14:39:34 from 59 official bars (April and October 2026 lists combined).

## How to check

For each leg below, look up the trip in WienMobil (or Google Maps) for **Saturday 14 November 2026, leaving at 14:00**. Enter the minutes from 14:00 until arrival (or a range such as 32-46) in the *WienMobil* column, then re-run `python pipeline/phase1_routing_check.py`. The script works out the differences and the median.

- Our transit time is the **median over all departure minutes from 10:00 to 22:00**, including the wait at the first stop, so it should usually be a few minutes above the best trip a planner shows for a well-timed departure.
- *Gewählt* applies the walking rule: walk if walking is at most 5 minutes slower than transit.
- *Öffis (meist)* is the 25th–75th percentile across departures.
- **Pass:** the median difference is at most 5 minutes.

## Sample legs

| # | Typ | Von | Nach | km | Zu Fuß | Öffis p50 (meist) | Gewählt | WienMobil | Diff | Ohne S-Bahn | Link |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | kurz | Kaffee Kunze (8.) | Cafe Zehnsiebzig (7.) | 0.7 | 12 | 12 (12–12) | 12 zu Fuß | 13 | -1 | 12 | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.208979,16.354633&destination=48.204399,16.347563&travelmode=walking) |
| 2 | kurz | Cafe Anno (8.) | Replugged (7.) | 0.8 | 10 | 10 (9–10) | 10 zu Fuß | 6 | +4 | 10 | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.208016,16.341797&destination=48.206257,16.352076&travelmode=walking) |
| 3 | kurz | Bierhof.Wien (1.) | Charlie P's Irish Pub (9.) | 0.9 | 12 | 12 (12–12) | 12 zu Fuß | 14 | -2 | 12 | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.210182,16.367364&destination=48.216611,16.359607&travelmode=walking) |
| 4 | kurz | Neunzehn (19.) | Anton Frank (18.) | 1.1 | 15 | 15 (15–15) | 15 zu Fuß | 20 | -5 | 15 | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.236456,16.353394&destination=48.229064,16.343706&travelmode=walking) |
| 5 | kurz | Erzherzogtum (6.) | Wombats Bar (4.) | 0.4 | 5 | 5 (5–5) | 5 zu Fuß | 6 | -1 | 5 | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.199427,16.364776&destination=48.196866,16.360807&travelmode=walking) |
| 6 | lang | Restaurant Karl-Wirt (23.) | Boulderbar Seestadt (22.) | 19.4 | – | 81 (77–85) | 81 Öffis | 80 | +1 | 88 (+7) | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.128585,16.297576&destination=48.230348,16.509651&travelmode=transit) |
| 7 | lang | Leopoldauer Alm (21.) | Restaurant Karl-Wirt (23.) | 19.2 | – | 75 (74–77) | 75 Öffis | 70-80 | +0 | 76 (+1) | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.265298,16.456518&destination=48.128585,16.297576&travelmode=transit) |
| 8 | lang | Gasthaus Tirolergarten (13.) | Boulderbar Seestadt (22.) | 16.3 | – | 74 (71–76) | 74 Öffis |  |  | 76 (+2) | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.179714,16.303372&destination=48.230348,16.509651&travelmode=transit) |
| 9 | lang | Gasthaus Emerich (21.) | Gasthaus Tirolergarten (13.) | 13.4 | – | 68 (65–70) | 68 Öffis |  |  | 71 (+3) | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.272444,16.418208&destination=48.179714,16.303372&travelmode=transit) |
| 10 | über die Donau | Restaurant Sternberg (22.) | Kaffee Kunze (8.) | 6.7 | 112 | 36 (32–40) | 36 Öffis | 32-46 | +0 | 36 | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.227124,16.440497&destination=48.208979,16.354633&travelmode=transit) |
| 11 | über die Donau | Mio - A Piece of Neapel (22.) | Café-Restaurant Zum Riesenrad (2.) | 3.9 | 57 | 20 (19–21) | 20 Öffis |  |  | 20 | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.241974,16.433044&destination=48.216873,16.396126&travelmode=transit) |
| 12 | über die Donau | Restaurant Sternberg (22.) | Replugged (7.) | 6.9 | 116 | 40 (36–44) | 40 Öffis | 38-44 | +0 | 40 | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.227124,16.440497&destination=48.206257,16.352076&travelmode=transit) |
| 13 | über die Donau | Edis Weinkeller (14.) | Schabanack (21.) | 12.2 | – | 53 (52–55) | 53 Öffis |  |  | 55 (+2) | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.193471,16.308389&destination=48.262985,16.436212&travelmode=transit) |
| 14 | über die Donau | Mio - A Piece of Neapel (22.) | Mostlandl (2.) | 4.2 | 60 | 20 (19–21) | 20 Öffis |  |  | 20 | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.241974,16.433044&destination=48.219223,16.387134&travelmode=transit) |
| 15 | Außenbezirke | Weinhaus Hochmayer (11.) | Marien Beisl (17.) | 7.7 | 108 | 45 (43–47) | 45 Öffis | 43-52 | +0 | 45 | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.179526,16.410373&destination=48.218634,16.324807&travelmode=transit) |
| 16 | Außenbezirke | Mabel's No90 British Pub & Cocktailbar (10.) | Soft Rock Cafe (12.) | 3.2 | 50 | 33 (31–35) | 33 Öffis |  |  | 33 | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.169260,16.370385&destination=48.179351,16.329696&travelmode=transit) |
| 17 | Außenbezirke | Marien Beisl (17.) | Wilder Mann (18.) | 1.8 | 29 | 23 (22–25) | 23 Öffis | 22-26 | +0 | 23 | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.218634,16.324807&destination=48.225465,16.346536&travelmode=transit) |
| 18 | Außenbezirke | Die Kulisse (17.) | Mabel's No90 British Pub & Cocktailbar (10.) | 6.3 | 93 | 47 (45–49) | 47 Öffis |  |  | 47 | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.217018,16.325600&destination=48.169260,16.370385&travelmode=transit) |
| 19 | Außenbezirke | Soft Rock Cafe (12.) | Bierosophie (16.) | 2.9 | 40 | 24 (22–25) | 24 Öffis |  |  | 24 | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.179351,16.329696&destination=48.205323,16.325923&travelmode=transit) |
| 20 | Außenbezirke | Anton Frank (18.) | Strasser Bräu (12.) | 5.2 | 70 | 31 (30–32) | 31 Öffis |  |  | 31 | [Google Maps](https://www.google.com/maps/dir/?api=1&origin=48.229064,16.343706&destination=48.183259,16.330098&travelmode=transit) |

Checked 11 of 20 legs. Median absolute difference: 1 min → **PASS** (threshold 5 min).

## Run

| | |
|---|---|
| Points | 59 |
| Network build | 220 s |
| Transit matrix (p25/p50/p75, 12-hour window) | 176 s |
| Walk matrix | 28 s |
| Total | 423 s |
| Peak memory (process RSS, JVM capped at 12G) | 12.1 GB |
| r5py | 1.1.7 |
| Departure window | 2026-11-14T10:00:00 + 12 h |
| Walking speed | 4.8 km/h |
| Matrix size | 59² = 3481 bytes each, Uint8, 255 = unreachable |
| Transit p50 over all pairs | median 31 min, max 81 min |
| Unreachable on foot within 2 h | 587 pairs (transit covers them) |
| Unreachable by transit | 0 pairs |
| S-Bahn effect (p50) | faster for 369 of 3422 pairs; mean gain where faster 2.9 min, max 11 min |

## Data used

| Data | Source | Service dates / state |
|---|---|---|
| Streets | Geofabrik Austria extract, clipped to 16.15,48.09,16.61,48.35 | downloaded 2026-11-03 |
| U-Bahn, tram, bus, Badner Bahn | Wiener Linien GTFS (also Mobility Database mdb-648, identical file) | 2025-12-14 to 2026-12-12 |
| S-Bahn and regional trains | ÖBB GTFS Soll-Fahrplan 2026 (data.oebb.at, CC BY 4.0, no registration) | 2025-12-14 to 2026-12-12 |
| District boundaries | Stadt Wien `BEZIRKSGRENZEOGD` via WFS | 23 polygons, AKT_TIMESTAMP 2026-09-01 |

The ÖBB feed is reduced to S, R, REX and CJX trains with stops inside the bounding box. Long-distance trains (Railjet, ICE, IC, Nightjet) and the CAT are left out. The ÖBB feed has no Wiener Linien trips, so the two feeds don't overlap.

Official-bar coordinates: see `reports/official_match.md` (58 of 59 matched to OSM; placed by address only: Gasthaus Emerich).
