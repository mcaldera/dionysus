# Phase 4 status (tagging stage 1, first batches)

Written while you were away. Nothing here is final; it's for your spot-check.

## Tag spot-check (gate)

Two batches of 25 bars were reviewed (50 bars). 21 of them got tags from Claude, 34 tag rows in total, all `reviewed=0` and shown muted in the app until you confirm them.
Bars without website text (most of your own tour tips) got **no** opinion tags: the rule is "missing tag = unknown, never guess". Tags from OSM data (Essen, Gastgarten) and the computed Lang offen still apply to them.

Please check these and tell me what's wrong or too generous; then I'll adjust the definitions before tagging the rest.

| Bezirk | Lokal | Tag | Evidence (paraphrased) |
|---|---|---|---|
| 10 | Mabel's No90 | essen | Website lists pub classics and burgers from its own kitchen |
| 12 | Biergasthof Otto | essen | Hot kitchen daily until 22:00 with Viennese dishes |
| 12 | Biergasthof Otto | gastgarten | Website mentions a shady garden used on summer evenings |
| 12 | Biergasthof Otto | urig | Open since 1991; team rarely changes and regulars value that |
| 15 | Brauhund | essen | Serves burgers and soul food alongside its beer |
| 19 | Unders | gastgarten | Website mentions outdoor seating by the Gürtel |
| 1 | Stadtboden | essen | Food from breakfast to late snacks; kitchen open until midnight |
| 1 | Stadtboden | gastgarten | Website mentions a Gastgarten |
| 2 | Mostlandl | essen | Gasthaus kitchen with Viennese home cooking and a lunch menu |
| 2 | Mostlandl | urig | Describes itself as a long-standing traditional Gasthaus without frills |
| 8 | Cafe Carina | live_musik | Artists' and music café in a Wagner station building; live music focus |
| 1 | Zapfmeisterei Bermuda Bräu | essen | Serves Viennese Wirtshaus classics alongside fresh tank beer |
| 1 | Zapfmeisterei Bermuda Bräu | modern | Presents Wirtshaus classics with a modern twist in a revived venue |
| 2 | VOLEE | essen | Restaurant in the Prater with its own menu |
| 2 | VOLEE | gastgarten | Website highlights a large garden |
| 3 | Marx gastro - Bier und mehr | essen | Viennese cooking with a weekday lunch menu |
| 3 | Marx gastro - Bier und mehr | gastgarten | Website describes it as a restaurant with a Gastgarten |
| 5 | Thell | essen | Restaurant with Viennese and international dishes; late kitchen on weekends |
| 5 | Thell | urig | Meeting place since 1973 with vaulted rooms |
| 5 | Thell | gastgarten | Garden in the inner courtyard |
| 6 | Addicted to Rock | essen | Presents itself as a burger bar |
| 9 | Charlie P's Irish Pub | essen | Pub food such as burgers and fish and chips |
| 10 | Boulderbar Hauptbahnhof | essen | Bar area serves pizza toasts stews and snacks after climbing |
| 12 | Strasser-Bräu | essen | Large menu of traditional Austrian dishes |
| 16 | Bierosophie | essen | Varied menu including vegan and vegetarian dishes |
| 16 | Bierosophie | urig | Family-run with a nostalgic atmosphere |
| 16 | Bierosophie | gastgarten | Guests mention a beer garden |
| 17 | Kulisse | essen | Beisl with its own food menu next to the stage |
| 17 | Kulisse | live_musik | Cabaret stage with regular music acts |
| 17 | Kulisse | gastgarten | Website mentions a new Schanigarten |
| 20 | Brigittenauer Stadl | essen | Daily set dishes such as schnitzel |
| 21 | Leopoldauer Alm | essen | Large Wirtshaus menu with platters and seasonal goose |
| 22 | Napoleon | essen | Gasthaus kitchen with seasonal goose menu |
| 1 | 1516 Brewing Company | essen | Full menu from soups to steak dishes |

Observations from tagging:

- **Preiswert / Gehoben:** no bar had explicit prices or statements strong enough. Expect these to stay rare unless we use your knowledge.
- **Urig vs. just cosy:** I only set Urig with a sign of age or tradition (since 1973, long-standing Gasthaus, regulars), not for "gemütlich" alone.
- **Live-Musik:** only for regular music programmes (Cafe Carina, Kulisse). Live sport, DJs and karaoke don't count.
- **Das Alt – Irish Pub Hietzing:** its website domain now shows an online casino. The OSM `website` tag should be removed or fixed (ideally in OSM itself).

## What changed in the bar list

- **New venue types** (your decision): Bar & Pub, Tschocherl & Café-Bar, Beisl & Wirtshaus, Heuriger & Buschenschank, Besondere Orte. Recorded in SPEC section 2 and 5.2.
- **Kaffeehäuser, Konditoreien, bakery and specialty-coffee cafés are out**: by name (Konditorei, Bäckerei, Zuckerbäcker, Coffee …), shop tags, chain list (Anker, Der Mann, Elou, Joseph Brot, Aida, Oberlaa, Felber, Ströck, Tchibo, Starbucks, Demel, Sacher, Diglas, Landtmann …), cake/coffee cuisine, daytime-only hours, or a website about cake rather than drinks.
- **Tschocherl are in**: cafés with Espresso, Stüberl, Eck, Treff … in the name, late hours, or drinks on their website. Small cafés *without any data* are included by default (your Espresso Babsi, Wunderlampe, Habakuk had none).
- **Restaurants**: only the *first* cuisine counts (Gasthaus Pezzl `regional;rumanian` is in, pizzerias are out). Untagged restaurants are in if open past midnight (Moped) or their website reads like a Wirtshaus (102 such).
- Result: **2140 bars**. Kept by rule: Austrian restaurant 552, café with a drinking name 53, untagged restaurant, Wirtshaus website 103, café: late hours or drinks on website 179, Heuriger 154, bar named Café or Espresso 53, untagged restaurant open past midnight 62, café without data, assumed Tschocherl 295, pub or bar 638, restaurant named Pub or Bar 38, official list 7, bowling 4.
- Of your tour bars, the 19 found in OSM all pass the rules except Cafe UKO (closes at 20:00 per OSM); your tip keeps it in anyway. Holzis turned out to be in OSM as "Café-Pub Holzi".

## Tips (`data/own/tips.csv`)

Your tour list plus public lists (Falter Lokalführer, 1000things) are in `data/own/tips.csv`. A tipped bar is never filtered out, gets tagging priority, and public tips show as "★ Tipp" in the app (your own list stays private).

Not found in OSM, please give me an address or street:

| Bezirk | Name | Source |
|---|---|---|
| 12 | Wilde Hilde | owner |
| 15 | Espresso Flamingo | owner |
| 10 | Cafe Impuls | owner |
| 22 | Tee- und Likörstube | Falter 2016 Tschocherl-Report |
|  | Café Inges Eck | Falter Lokalführer: Wiens neue Tschocherln |
|  | Lindwurmstüberl | Falter Lokalführer: Wiens neue Tschocherln |

Reddit blocks automated access (403; its API needs a registered app), so I couldn't read the thread you linked. To use Reddit threads, open them, select all, copy, and paste into a `.txt` file in `data/own/tips/`; I'll parse names from it.

## UI changes (your list)

1. **New look**: dark header, floating glass cards over a full-size map, type-coloured pills, open-until badges.
2. **Easier browsing**: dots are coloured by type (legend = the filter chips in the header); bars with more info are slightly larger; hovering a dot shows a card with type, tags, open status and the travel time from the selected bar; recommendation cards show type, open-until, tags (liked ones in green) and travel time. No photos: Google images can't be used, and copying photos from bar websites would be a copyright problem.
3. **District hover**: the hovered district is outlined and named with its bar count; the others fade.
4. **Real routes**: walking legs follow the streets (FOSSGIS OSRM, public OSM routing). Transit legs are drawn as red dashed arcs; the actual line names need `r5py.DetailedItineraries` (planned for later in the spec).
5. **Hover shows travel time** from the selected bar.
6. **Geschmackstest**: 10 sample bars, like/dislike; the answers become liked/avoided tags and venue types. It gets better as more bars are tagged.
7. **District numbers** on the map (names when zoomed in), clearer borders with a white casing.

## Next steps

- You: spot-check the tags above; add addresses for the missing tips; optionally paste Reddit threads into `data/own/tips/`.
- Then: tagging stage 1 for the remaining bars (up to 15 per district), and the Phase 5 solver.
