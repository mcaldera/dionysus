# Closure check: bars that have probably closed

Written 2026-11-04 by `pipeline/closure_check.py` (re-run it to update this file; the reviewer notes at the end are kept). All candidates with their signals: `data/interim/closure_candidates.csv`. Nothing was hidden or changed in the data.

## What was checked

- **2138 published bars** (hidden ones in `overrides.csv` skipped).
- **Website text** that step 04 cached for 994 bars: wording for a permanent closure, farewell, handover or new name; parked or for-sale domains; casino takeovers; sites about another business. Closing days, holidays, scheduled closures, terrace or kitchen closures and venue history are ignored.
- **Websites re-checked today** (174): those that failed in step 04 or looked odd. Same rules as step 04: robots.txt, at least 1 s per domain, generic client name, home page only, no social media. 59 are dead (domain gone, refused, no answer, or 404/410).
- **OpenStreetMap today**: one Overpass query (our bar ids, plus food/drink venues and disused/was objects in Vienna), data as of **2026-11-04T16:03:43Z**, compared with our extract of **2026-11-03T14:09:34Z** that the published data is built from (only a day older, so few OSM changes were expected). Checked: deleted elements, lifecycle tags (disused:, was:, ...), lost amenity, renames, opening_hours=closed/off and note/fixme/description wording, and disused objects with the same name next to a bar.
- **OSM Notes**: 5061 notes in the Vienna bbox (open, plus closed in the last 2 years), 4 requests. A note counts if it links the bar's element, names it, or (only while open) lies within 60 m and names no other place. Resolved notes no longer count once the bar's element was edited afterwards.

**Confidence.** High: the bar's own website or OSM says it closed, or two independent sources agree. Medium: one fairly clear sign (lost domain, OSM note about the bar, OSM tag saying closed). Low: one weak sign (dead website, nearby note, temporary closure). A dead website alone is weak, many Beisln let their site lapse. A working own website without closure signs lowers OSM- or note-only findings by one level.

**Suggested action.** *hide*: add `hidden=1` in `overrides.csv`. *fix in OSM*: OSM still shows the bar as open (or contradicts itself); correct it there, as SPEC prefers, and it drops out at the next import (add `hidden=1` meanwhile if it should go now). *check by hand*: look before doing anything. *temporarily closed*: nothing to do yet.

## Result: 112 candidates

- high: 8
- medium: 24
- low: 80 (57 only a dead website, 6 temporarily closed)

## High confidence

| Bezirk | Lokal | Evidence | Suggested action |
|---|---|---|---|
| 1 | Boho | Website announces permanent closure | fix in OSM |
| 1 | Gösser Bierklinik | Website domain now shows a casino/betting site; OSM note #5580063 (2026-10, open) reports it closed | fix in OSM |
| 2 | Harvest | Website announces permanent closure | fix in OSM |
| 3 | Arkade Restaurant | Website now only shows a farewell note | fix in OSM |
| 9 | Klub Gru | Website names a last opening day; website says it went to a new operator | fix in OSM |
| 20 | Zwischenbrückenwirt | OSM now marks it disused/former | hide |
| 22 | Flokal | Website says owner leaves the trade; OSM note #5558366 (2026-10, open) reports it closed | fix in OSM |
| 23 | Park Café Mauer | OSM tags it disused but keeps the amenity | fix in OSM |

## Medium confidence

| Bezirk | Lokal | Evidence | Suggested action |
|---|---|---|---|
| 1 | Enrico Panigl nfg. | Website domain now shows a casino/betting site | check by hand |
| 1 | Kussmaul | Website domain now shows a casino/betting site | check by hand |
| 1 | Paul & Vitos | Website domain now shows a casino/betting site | check by hand |
| 1 | Rokos Bar | OSM opening_hours says closed; OSM description says currently closed | fix in OSM |
| 1 | St. Ribbs | OSM opening_hours says closed; website domain no longer resolves | fix in OSM |
| 2 | Bistro 2.0 | Website domain now shows a casino/betting site | check by hand |
| 3 | Bar Black Lounge | Open OSM note #5475716 1 m away reports a closed bar | check by hand |
| 4 | Just 4 Fun | OSM note #4925735 (2025-08, resolved) reports it closed | check by hand |
| 4 | Schwarzberg | Website domain now shows a casino/betting site | check by hand |
| 6 | Cortado | Renamed in OSM to 'toast. ed' since our extract | check by hand |
| 6 | Ludwig Van | Website domain now shows a casino/betting site | check by hand |
| 9 | Café Afro | OSM opening_hours says closed | fix in OSM |
| 12 | Café-Restaurant Schönbrunn | Domain parked or offered for sale | check by hand |
| 13 | Das Alt - Irish Pub Hietzing | Website domain now shows a casino/betting site | check by hand |
| 15 | Sechshauserwirt | Website domain now shows a casino/betting site | check by hand |
| 16 | Смачно | OSM opening_hours says closed | fix in OSM |
| 19 | Heurigenschank "Zum Berger" | Website domain now shows a casino/betting site | check by hand |
| 19 | SLU-Bar | Website domain now shows a casino/betting site | check by hand |
| 19 | Schiefer Giebel | OSM description says private events only | fix in OSM |
| 19 | Schimanko's Winzerhaus | Website domain now shows a casino/betting site | check by hand |
| 22 | Gasthaus Binder | Website domain now shows a casino/betting site | check by hand |
| 22 | Kaisermühlenparadies | OSM note #5551636 (2026-10, open) reports it closed | check by hand |
| 22 | PSV Beisl | Domain parked or offered for sale; OSM note #5392832 (2026-07, open) reports it temporarily closed | check by hand |
| 22 | Zum 100er | Website domain no longer resolves; OSM fixme asks whether it still exists | check by hand |

## Low confidence

Temporarily closed: Atmosphere Rooftop Bar (1.), Zwölf Apostelkeller (1.), Acabar (7.), The Short Hall (7.), Gasthaus zum Heimkehrer (10.), DonauStadtwirt (22.).

Other weak signs:

- Lindenkeller (1.): Website replaced by a hosting placeholder
- Monte Ofelio Bar (1.): Website is an empty 'coming soon' page
- s'Biergart'l im Stadtpark (1.): Website is an empty 'coming soon' page
- Carmen (3.): Open OSM note #5475716 32 m away reports a closed bar
- Birdcage (6.): Website is about another business (bar not named)
- Gustav Emil Paula Paula (7.): Website is about another business (bar not named)
- Cafe Saadi (9.): Website is about another business (bar not named)
- Gastwirtschaft Schmid (11.): OSM also has an older disused object with this name; own website still looks active
- Kleines Cafe (14.): OSM also has an older disused object with this name
- das Bach (16.): Website is an empty 'coming soon' page
- Heurigen Restaurant Pötzleinsdorf (18.): Website is about another business (bar not named)
- Liebstöckl (19.): OSM opening_hours says closed; own website still looks active
- Couch Potato (20.): Website replaced by a hosting placeholder
- Buschenschank Zum Gustl (21.): Website is about another business (bar not named)
- Weingut Deutinger (21.): Website redirects to another business (bar not named)
- Kaimü (22.): Website is about another business (bar not named)
- Kesselbar (22.): Website is about another business (bar not named)

Only a dead website (57): Bergstation Tirol (1.), Cafe Porta (1.), Ferrari Caffe (1.), Mundart (1.), Rainers Bar (1.), Seiler's (1.), Servus Wien Hohenstaufengasse (1.), das Hegel (1.), Altenberg (2.), Café Nebenan (3.), Heuriger zur alten Weinpresse (3.), The Golden Harp (3.), Trinity (4.), Cafe Matz (5.), Le Sette Fontane (5.), Reinprechtsstüberl (5.), polt bayrish pub (5.), KUKU (6.), Luster (6.), if dogs run free (6.), MQ-Kantine (7.), Wandel (7.), Feivel's (8.), Rosnovsky&Co (8.), flinte (8.), Potions The Magical Cocktail Pub (9.), Schwirtz (9.), Studio 15 (9.), Big Ben (10.), Buschenschank Bruckner Schurli (10.), Cafe CAmeo (10.), Gasthaus Haschka (12.), V8cht (12.), Wilhelmsdorfer Stube (12.), lê Sucré (12.), Restaurant Sport-Union (13.), Schaumweinhäuschen (13.), Schneider-Gössl Sektbar (13.), Kleines Schutzhaus Rosental (14.), Megiddo (14.), Hopfen-Stuben (15.), CAY (Cafe am Yppenplatz) (16.), Ottakringer Stub'n (16.), Postsport Stüberl (17.), Gasthaus Grabmüller (19.), Restaurant Brandl (19.), Restaurant so guad... (19.), Billard Lounge (20.), Cafe Helga (21.), Heurigenrestaurant Wild (21.), Mokador (21.), Einkehr Weisser Esel (22.), Fat George Gasthaus (22.), Timeout (22.), Cafe Melange (23.), La Piazza D'oro (23.), Liesinger Bräu (23.).

## Fix in OSM

OSM still shows these as open venues. Edit only with a reliable source (a visit, or the venue's own announcement); don't copy from Google.

- Boho (1.), `osm:node/4858600328`: still a venue in OSM; if confirmed, retag as disused:amenity or remove
- Gösser Bierklinik (1.), `osm:node/298713610`: still a venue in OSM; if confirmed, retag as disused:amenity or remove
- Harvest (2.), `osm:node/2529269365`: still a venue in OSM; if confirmed, retag as disused:amenity or remove
- Arkade Restaurant (3.), `osm:node/1949307283`: still a venue in OSM; if confirmed, retag as disused:amenity or remove
- Klub Gru (9.), `osm:node/1707194114`: website says a new operator took over; after checking, rename or retag it
- Flokal (22.), `osm:node/2391161680`: still a venue in OSM; if confirmed, retag as disused:amenity or remove
- Park Café Mauer (23.), `osm:node/1363149567`: has amenity plus disused=yes, which our import keeps; retag as disused:amenity
- Rokos Bar (1.), `osm:node/2343158536`: opening_hours=closed but still a venue; if gone for good, retag as disused:amenity
- St. Ribbs (1.), `osm:node/567077591`: opening_hours=closed but still a venue; if gone for good, retag as disused:amenity
- Café Afro (9.), `osm:node/4433210952`: opening_hours=closed but still a venue; if gone for good, retag as disused:amenity
- Смачно (16.), `osm:node/8739889393`: opening_hours=closed but still a venue; if gone for good, retag as disused:amenity
- Schiefer Giebel (19.), `osm:way/223693538`: says private events only; remove the amenity or add access=private
- Liebstöckl (19.), `osm:node/4256186526`: opening_hours=closed although its own website looks active; check and fix hours or retag

## Websites now owned by someone else

These links lead to casino, betting, parking or domain-sale pages. Whether or not the bar still runs, the `website` tag in OSM is wrong and should be removed or replaced there; until then the site links to spam.

Gösser Bierklinik (1.), Enrico Panigl nfg. (1.), Paul & Vitos (1.), Kussmaul (1.), Bistro 2.0 (2.), Schwarzberg (4.), Ludwig Van (6.), Café-Restaurant Schönbrunn (12.), Das Alt - Irish Pub Hietzing (13.), Sechshauserwirt (15.), Schimanko's Winzerhaus (19.), Heurigenschank "Zum Berger" (19.), SLU-Bar (19.), Gasthaus Binder (22.), PSV Beisl (22.).

## Hacked websites (bar content still there)

Casino spam injected into the bar's own site. Not a closure sign, but the link is unpleasant: Bierhalle am Naschmarkt (6.), Trixie Kiddo's (7.), Grind (9.), Berliner Babo (12.).

## What could not be checked

- 964 bars have no website: only OSM and notes were checked for them.
- 31 bars only link a social media page, which we don't fetch.
- 22 websites refused or failed the re-check (robots.txt, 403, 429, 5xx); not counted either way: 57 Restaurant & Lounge (22.), Basz Bar (2.), Bettel Student (1.), Brezel Gwölb (1.), Café Leopold (7.), Café Negroni (9.), Der Bettelstudent (1.), Fledermaus (1.), Fräuleins fabelhafter Sommergarten (1.), Gastwirtschaft (12.), Genuss Treff Rosenhügel (23.), Noah´s Ark Experimental Cocktail Club (7.), Platin (22.), Puff (6.), REDROOF (2.), Schrammelbeisl (17.), Schutzhaus Hackenberg (19.), Stammersdorf-Grill (21.), The Birdyard (8.), Tin To (9.), Tuk Tuk (4.), Zum Bettelstudent (1.).
- Google Maps, Reddit and social media were not used, as agreed.

## Reviewer notes

Checked by hand on 2026-11-04 from the cached pages, OSM and the notes (no visits, no Google):

- **Klub Gru (9.)**: handed to a new operator on 1 Oct 2026 and reopened under a new name (Dartside of the Moon). Rename it in OSM rather than hide it; the new place may still fit the map.
- **Flokal (22.)**: the owner writes that they are leaving the trade; closed until further notice. A CoMaps user confirmed it in Oct 2026.
- **Park Café Mauer (23.)**: a StreetComplete user found the gates locked (Jul 2026) and a mapper added `disused=yes`; the old domain now redirects to the Park Hotel Mauer event-location site. Our import doesn't drop `disused=yes`, so hide it or retag it in OSM.
- **Zwischenbrückenwirt (20.)**: retagged as `disused:amenity` in OSM today, after our extract. It drops out at the next import.
- **Gösser Bierklinik (1.)**: the domain now redirects to a sports-betting site and a CoMaps user reported it closed (Oct 2026). A well-known place, so worth a quick look before acting.
- **Cortado (6.)**: renamed in OSM today to a daytime restaurant (open 9-17), which wouldn't pass our filters. Re-import or hide.
- **Just 4 Fun (4.)**: two mappers wrote in 2025 that it has been gone for over a year (now an empty kebab shop); the note was closed without changing OSM.
- **Kaisermühlenparadies (22.)**: a StreetComplete user wrote in Oct 2026 that it has been closed for over a year; OSM unchanged since 2022.
- **Bar Black Lounge (3.)**: an open note placed right on it says the bar has been gone since 2025.
- **Liebstöckl (19.)**: OSM has had `opening_hours=closed` since 2023, but its website presents an active Beisl in Grinzing. Perhaps reopened; the OSM hours need fixing either way.
- **Websites pointing elsewhere**: Cafe Saadi links to an Italian restaurant on the same square; Birdcage shares address and website with "zum wohl" (also in OSM, maybe a duplicate or old name); Gustav Emil Paula Paula links to a hairdresser in the same street; The Short Hall links to The Duke Pub (closed for renovation). Possibly renamed places or wrong `website` tags.
- **Casino domains**: they only show that the domain lapsed; the bar may still run. Berliner Babo, Grind, Trixie Kiddo's and Bierhalle are hacked, not closed.
