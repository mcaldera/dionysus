# Phase 5 status (tour planner) and end of tagging stage 1

Written 2026-11-04. Nothing is committed. All checks pass: 29 unit tests, 7 end-to-end tests, 27 pipeline tests, lint and the production build.

## Your four UI points

1. **Click on empty map** closes the selected bar, an open swap list and any open popover (Vorlieben, time). Escape does the same. The zoom buttons moved to the top left; they were hidden under the panel.
2. **Geschmackstest** no longer shows bars by name. It asks 8 this-or-that questions about kinds of places: Altes Beisl or Neue Bar, cheap or upscale, Absteigen yes or no, food, outside, live music, how late, and which venue types must be in the tour. Each has "Egal". The answers become liked and avoided tags.
3. **Planning help** (this is Phase 5 of the spec):
   - **Komplette Tour vorschlagen** (start card): tries every district as the start and shows the best three tours with start → end district, total time, travel time, walk/transit legs, matching stops and closed warnings. Hovering one draws it on the map; "Übernehmen" applies it. Takes about 4 s.
   - **Touren ab hier** (on a selected bar, while the tour is empty): three different tours that start at that bar.
   - **Your own picks, connected for you**: add any bars ("Zur Tour hinzufügen" pins them, 📌), then **↻ Optimieren**. Pinned bars stay, everything else and the order are chosen anew; a pinned first stop stays the start.
   - **✨ Tour fertig planen**: keeps your stops in their order and plans the remaining districts.
   - **⇄ Tauschen** on any stop: lists other bars in that district ranked by how well they fit between the stop before and after (green = shorter walk/ride). Hovering shows the leg on the map; picking one replaces and pins it. Clicking a bar on the map in a district you already have offers "Statt … nehmen".
   - **Recommendations** now also check the rest of the tour: each shows "Tour +N Min.", how much longer the best remaining tour gets by going there, and the list re-sorts.
   - **District scope**: under 🕒 you can choose which districts the tour covers and an optional last district.
4. **Routes on the map**: transit legs are now drawn along the actual line in its colour (U1 red, U3 orange, U6 brown, buses blue), with the line name on the map and in the timeline, e.g. "U3 → U1 · 14 Min. Öffis (meist 12-17)". The shortest connection is shown; when others of similar length exist, the timeline adds "oder 11A → S1". Until a route has loaded, the leg is a thin dashed arc.

## How the solver works (short)

One bar per district, open ends, following SPEC 9. Two changes from the spec's starting values, now recorded there:

- **Candidates per district** (15): with no preferences, a quarter are well-known places (tips, official, tags), a quarter are bars close to neighbouring districts (good handovers), the rest spread across the district. Bars known to be closed all day are skipped.
- **Polish**: after the search, every eligible bar of each district is tried in place.

Together these cut the best 23-district tour from 234 to 195-203 travel minutes. One solve takes 0.6-0.8 s in a background worker, so the page never freezes.

## Transit routes: one thing to decide before publishing

Line routes come from [Transitous](https://transitous.org/api/), a free volunteer-run routing service. Travel times still come from our own matrices; Transitous is only used to draw the lines. Its terms fit a private, non-commercial project like this, but before the site goes public it asks for:

- the source code published under an open-source licence,
- a visible link to transitous.org/sources (already in the footer),
- contact information on the site (ties in with the legal-notice question in SPEC 12),
- light use. We request a route only for transit legs in your tour and for the leg you hover, cached, at most two at a time.

If you'd rather not open-source the code, the alternative is to precompute line routes offline (`r5py.DetailedItineraries`, already listed under "Later"); with 4.5 million bar pairs, that only works for the legs of saved tours.

## Tagging stage 1: done

All 345 stage-1 bars (up to 15 per district) were reviewed: 358 tag rows on 229 bars (essen 207, gastgarten 74, urig 42, modern 14, live_musik 10, preiswert 9, gehoben 2), all marked unreviewed. Together with OSM and computed tags, 73 bars now carry an opinion tag (Urig, Modern, Preiswert, Gehoben, Live-Musik).

Same rules as before: evidence only, paraphrased, at most 15 words; Urig needs a sign of age or tradition or an explicit self-description; Preiswert and Gehoben need prices or an explicit statement (owner replies count, guest reviews don't); Live-Musik needs a regular programme (karaoke, DJs and sport don't count).

### Bars that need a look (data problems, not tags)

| Bezirk | Lokal | Problem |
|---|---|---|
| 12 | Berliner Babo | Website now shows casino spam |
| 2 | Bistro 2.0 | Website now shows casino spam |
| 22 | Gasthaus Binder | Website now shows casino spam |
| 13 | Das Alt (Irish Pub Hietzing) | Website now shows casino spam (from last report) |
| 22 | Flokal | Website: "bis auf Weiteres geschlossen" |
| 14 | BergGasthof | OSM hours: "vorübergehend geschlossen" |
| 22 | DonauStadtwirt | Website says closed since a 2022 winter break; may be stale |
| 19 | Liebstöckl+Co | OSM hours say "closed", website says daily 11-23 |
| 12 | Café-Restaurant Schönbrunn | Domain for sale; OSM hours say event rental only |
| 19 | Gasthaus zum Agnesbrünnl | Website belongs to another place (Jägerwiese) |
| 6 | Birdcage | Website is "Zum Wohl"; renamed? |
| 13 | Mario | Website is Plachutta Nussdorf |
| 15 | Chilinos | Website is Mamma Pazza (pinsa) |
| 23 | Gourmet Silo | A catering canteen (weekdays to 14:30), not a bar |
| 15 | Lia | Daytime café (to 16:00) |
| 7 | Champagne Characters | Mainly a shop (to 19:00/20:00) |
| 9 | Ginger & Spice | Asian takeaway |
| 16 | Ottakringer Shop | Brewery shop; it's on the official list, so kept |
| 18 | Meierei Diglas | Part of the Diglas Kaffeehaus family, which the chain list excludes |
| 13 | Argo | Greek restaurant classed as Beisl |

Say which to hide (`overrides.csv`) and which to fix in OSM.

### Spot-check (gate)

Essen and Gastgarten are low-risk. These are the opinion tags from batches 3-8:

| Tag | Bezirk | Lokal | Evidence (paraphrased) |
|---|---|---|---|
| Urig | 1 | Bastei Beisl | Family-run Beisl, cellar room with tiled stove |
| Urig | 1 | Beim Czaak | Run by the Czaak family since 1926 |
| Urig | 1 | Krah, Krah | Beer Beisl in the Bermuda triangle since the 1980s |
| Urig | 1 | Wiener Stadtbräu | Rustic beer place built on traditional Wirtshaus culture |
| Urig | 4 | Alt-Wiener Gasthaus Buchecker und Sohn | Calls itself an old-Viennese Gasthaus; butchering day each Tuesday |
| Urig | 5 | Haas Beisl | Traditional Viennese Wirtshaus with a long history |
| Urig | 6 | Barfly's | Classic cocktail bar since 1990, concept unchanged |
| Urig | 7 | 7Sternbräu | Brewing its own beer here since 1994 |
| Urig | 7 | Amerlingbeisl | Viennese Beisl since 1980 |
| Urig | 8 | Centimeter I | Traditional Viennese Gasthaus, family-owned for generations |
| Urig | 9 | Buffet Colosseum | Traditional restaurant with nostalgic 1920s interior |
| Urig | 10 | Buchenbeisl | Real Viennese Beisl since 1999, a second living room for regulars |
| Urig | 11 | Gastwirtschaft Schmid | Old-Viennese Wirtshaus since 1895, family-run since 1928 |
| Urig | 11 | Hopfen & Malz | Viennese Wirtshaus since 1988 |
| Urig | 14 | Gasthaus Maria-Brunn | Saturday roast from a wood oven by an old family recipe |
| Urig | 14 | Hotel zum Ochsenkopf | House built 1928, run by the same family since 1948 |
| Urig | 14 | Musil | Family business since 1910 |
| Urig | 14 | Peschta | Gasthaus run by the same family since 1930 |
| Urig | 15 | Bieriger | Presents itself as a traditional Viennese beer place |
| Urig | 15 | Brauhof Wien Kaltenhausen | Inn and hotel on this site for over 100 years |
| Urig | 15 | Gasthaus Quell | Gasthaus at this address since 1896 |
| Urig | 16 | Blunzenstricker | Calls itself the most traditional Wirtshaus in Ottakring |
| Urig | 16 | Gasthaus Starchant | Calls itself a Gasthaus rich in tradition |
| Urig | 16 | Schutzhaus Waidäcker | Long-established Gasthaus with ski-hut atmosphere |
| Urig | 16 | Schwarzer Rabe | Pub at this address since 1905 |
| Urig | 17 | BrauBar | Describes itself as cosy and urig, lots of wood and brick |
| Urig | 17 | Gasthaus am Predigtstuhl | Family-run Gasthaus for over 30 years |
| Urig | 17 | Schutzhaus am Schafberg | Describes an urig ambience with crackling fireplaces |
| Urig | 18 | Centimeter VI | Traditional Viennese Gasthaus, family-owned for generations |
| Urig | 18 | Centimeter VII | Traditional Viennese Gasthaus, family-owned for generations |
| Urig | 18 | Edelhof | Old place, long in the street, many regulars |
| Urig | 19 | Fischerbräu | Viennese brewpub since 1985 |
| Urig | 19 | Gasthof zum Renner | Viennese inn since 1899 |
| Urig | 19 | Häuserl am Stoan | Family business on the Höhenstraße since 1923 |
| Urig | 20 | Gasthaus Haller | Traditional Gasthaus in the Brigittenau since 1983 |
| Urig | 21 | NEUERWirt | Gasthaus with boat rental since 1972, traditional concept |
| Urig | 22 | Alt Wiener Stuben | Calls itself a Viennese Gasthaus rich in tradition |
| Urig | 23 | Gasthaus Robert Lichtenstöger | Viennese Wirtshaus since 1962 |
| Modern | 2 | Stuwer | Calls itself a new Viennese Beisl |
| Modern | 3 | 575 Sagmeister | Creative modern take on Austrian cooking |
| Modern | 4 | Cafe - Restaurant im Otto Wagner Pavillon | Trendy brunch café with specialty coffee and natural wines |
| Modern | 5 | Rudis Beisl | Presents a modern take on Viennese Beisl cooking |
| Modern | 6 | Bierhalle am Naschmarkt | Modern Wirtshaus food in a lounge atmosphere |
| Modern | 7 | Atlas Bar and Gallery | Natural wine bar, a classic Beisl with a modern twist |
| Modern | 7 | Boheme | Austrian dishes reinterpreted in creative set menus |
| Modern | 10 | Aurora Rooftop Bar | Rooftop bar in Nordic design with a fireplace |
| Modern | 10 | Campus Bräu | Modern beer place with an urban character |
| Modern | 14 | Kenks | Modern restaurant with urban ambience and design |
| Modern | 17 | Bierraum | Describes a modern ambience and trendy beer bar |
| Modern | 17 | XXXL Grill Restaurant | Modern, stylish interior |
| Modern | 19 | Brandauers Bierbögen | Beer hall in a modern industrial style |
| Preiswert | 1 | Café Bendl | Known for very student-friendly prices |
| Preiswert | 6 | Edmund | Standing beer bar promising affordable draught beer without frills |
| Preiswert | 8 | Centimeter I | Owner stresses big portions at low prices |
| Preiswert | 8 | Debakel | Seidl, Spritzer or schnapps for 2.50 euros |
| Preiswert | 9 | Amananths Place | Website promises cheap drinks |
| Preiswert | 12 | Gasthaus Maria | Calls its Viennese home cooking good but inexpensive |
| Preiswert | 16 | Kod Kuma | Promises good food at pleasant, not expensive prices |
| Preiswert | 18 | Centimeter VI | Owner stresses big portions at low prices |
| Preiswert | 18 | Centimeter VII | Owner stresses big portions at low prices |
| Gehoben | 1 | Atmosphere Rooftop Bar | Ritz-Carlton rooftop bar, described as an upscale experience |
| Gehoben | 5 | Gergely's | Menu with lobster soup and tartare up to 29 euros |
| Live-Musik | 4 | Johnny's Pub | Live gigs and events on a regular basis |
| Live-Musik | 7 | Atlas Bar and Gallery | Hosts jazz nights and concerts |
| Live-Musik | 7 | Replugged | Live music club with national and international bands |
| Live-Musik | 8 | Club Lucia | Club with a stage for live acts |
| Live-Musik | 8 | Coco | Weekly programme with live music and DJs |
| Live-Musik | 14 | Reigen | Club with regular blues, jazz and other concerts |
| Live-Musik | 19 | Martin Sepp | Live music on Fridays and Saturdays from 18:30 |
| Live-Musik | 20 | Kulturcafé HENRIETTE | Calendar lists several live concerts each month |

## Changes from the spec

- The start screen is a card in the panel ("Wie möchtet ihr planen?") instead of a separate screen, to keep things lighter. The settings it would hold are under 🕒 in the header.
- The "Geschmackstest" isn't in the spec; it fills the group's likes and avoids.
- Saving, share links, participants and multi-day splits are Phase 6.

## Your to-dos

- **Phase 5 gate:** plan a full tour both ways ("Komplette Tour vorschlagen", and stop by stop plus "Tour fertig planen") and check that the timeline is believable.
- **Phase 4 gate:** spot-check the tags above.
- Decide on the open-source question for Transitous, or tell me to plan the offline alternative.
- Still open from last time: addresses for Wilde Hilde, Espresso Flamingo, Cafe Impuls, Tee- und Likörstube, Café Inges Eck and Lindwurmstüberl.

## Next

Phase 6: saving and share link, participants with their own likes, per-person match counts, and splitting into days.

## Update 2026-11-04 (afternoon): your second list

1. **Filter vs. planning split.** Top left, **⚲ Filter** changes only what you see on the map and what recommendation and swap lists offer: venue types, "must have" features (Essen, Gastgarten, Urig …), recommended by, and "not known to be closed at day/time". **🗺 Tour planen** (top right) holds everything the planner uses: day, start, stay, districts, first and last district, walking preference (Lieber zu Fuß / Ausgewogen / Am schnellsten), venue types for planning, preferences and the taste quiz. Filtering for Essen in one district no longer changes the whole tour.
2. **Leere Vorlage**: one open place per planned district, ordered by district centres. Fill the ones you know (a bar in a district with an open place goes into that place), then **✨ Tour fertig planen** fills the rest in that order and adds any missing districts at the end. **↻ Optimieren** works as before.
3. **Drag and drop**: drag rows by ⠿ to change the order.
4. **Statistics**: with a tour and nothing selected, the panel shows "Eure Tour in Zahlen": times, travel time by mode (walking, bus, U-Bahn, tram, S-Bahn, from the drawn routes), venue types, features and warnings. The start card only shows while nothing is planned.
5. **Sources filter**: Fachpresse (Falter, 11 bars), Stadtmagazine & Blogs (1000things, offbeat, 9), Foren (Reddit, none yet) and Seidlwandertage-Partner (59). Paste Reddit threads into `data/own/tips/` and they'll show up under Foren.
6. **Click on the map → row in the tour** is highlighted and scrolled into view.
7. **⌫ leeren** empties a place and keeps it (hollow marker at the district centre, dashed lines to its neighbours); **×** deletes the place and later stops move up. ⇄ on an open place suggests bars by the time they add.
8. **Swap mode on the map**: hovering any bar in that district shows "+N Min. Weg" against the current one; a click takes it.
9. **No straight back** (on by default, in the plan dialog): two transit legs in a row that reverse direction cost 30 extra minutes, so the solver avoids them. On the real data the best tour went from 1 reversal to 0 and got 2 minutes shorter; proposals take about 8 s instead of 5 s. When the drawn routes show the same line both ways, the timeline warns "↩ Gleiche Linie hin und zurück".
