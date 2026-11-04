# Bars (Phase 2 gate)

OSM data as of 2026-11-03T14:09:34Z (Overpass, the query from SPEC 5.2, which works as written). 4967 elements returned.

**1824 bars** after filters, deduplication and adding official bars. Above the 1,000 the spec plans for, after the owner's narrowing; travel matrices are no problem at this size.

## What was dropped

| Reason | Count |
|---|---|
| other restaurant | 2333 |
| café: no opening hours or website (C) | 262 |
| café: always closes by 18:00 (B) | 148 |
| café: coffee, cake or breakfast place (A) | 133 |
| chain | 94 |
| café with foreign cuisine | 81 |
| no name | 45 |
| ice cream or tea | 40 |
| bakery café | 11 |
| disused or abandoned | 8 |
| duplicate (similar name, < 30 m) | 7 |

*Other restaurant* means `amenity=restaurant` with a non-Austrian cuisine (pizza, sushi, kebab, ...), or with neither an Austrian/regional cuisine tag nor Gasthaus, Beisl, Wirtshaus, Bräu, Stüberl, Weinhaus, Wirt, Schenke, Stadl or similar in the name. *Chain* covers Aida, Starbucks, Oberlaa, Segafredo, Tchibo, Anker, Der Mann, McCafé, Ströck, Coffeeshop Company, Wild Bean Cafe, Teeamo, Julius Meinl, Admiral Sportwetten and similar.

Duplicate examples (kept ← dropped): Crown and Sword ← Crowns and Swords; Pfudl ← Gastgarten Pfudl; Saint George Cocktail Bar ← Saint George Cocktail Bar; Café Leo ← Café Leo; MGV Book & Coffee ← MGV Book & Coffee (Woman); The Comedy Pub ← The Comedy Pub; Rad- und Wanderschenke ← Rad und Wanderschenke.

## Bars per district and type

| Bezirk | Pub/Bar | Gasthaus/Beisl | Café/Heuriger | Spezial | Total | Opening hours | Website |
|---|---|---|---|---|---|---|---|
| 1 | 134 | 73 | 59 | 0 | 266 | 197 (74%) | 181 (68%) |
| 2 | 51 | 39 | 28 | 0 | 118 | 97 (82%) | 70 (59%) |
| 3 | 29 | 31 | 42 | 1 | 103 | 92 (89%) | 53 (51%) |
| 4 | 29 | 19 | 19 | 1 | 68 | 62 (91%) | 40 (59%) |
| 5 | 20 | 16 | 22 | 0 | 58 | 50 (86%) | 33 (57%) |
| 6 | 61 | 13 | 13 | 0 | 87 | 64 (74%) | 51 (59%) |
| 7 | 62 | 27 | 34 | 1 | 124 | 113 (91%) | 75 (60%) |
| 8 | 34 | 14 | 14 | 0 | 62 | 54 (87%) | 48 (77%) |
| 9 | 35 | 25 | 29 | 0 | 89 | 79 (89%) | 56 (63%) |
| 10 | 39 | 25 | 25 | 1 | 90 | 59 (66%) | 40 (44%) |
| 11 | 9 | 12 | 11 | 0 | 32 | 25 (78%) | 14 (44%) |
| 12 | 13 | 28 | 14 | 0 | 55 | 48 (87%) | 29 (53%) |
| 13 | 9 | 14 | 11 | 0 | 34 | 28 (82%) | 27 (79%) |
| 14 | 11 | 16 | 12 | 1 | 40 | 33 (82%) | 21 (52%) |
| 15 | 30 | 16 | 26 | 0 | 72 | 56 (78%) | 30 (42%) |
| 16 | 29 | 15 | 33 | 1 | 78 | 60 (77%) | 39 (50%) |
| 17 | 13 | 18 | 12 | 1 | 44 | 33 (75%) | 26 (59%) |
| 18 | 12 | 8 | 4 | 0 | 24 | 20 (83%) | 16 (67%) |
| 19 | 17 | 20 | 67 | 0 | 104 | 65 (62%) | 76 (73%) |
| 20 | 16 | 13 | 18 | 2 | 49 | 36 (73%) | 15 (31%) |
| 21 | 14 | 27 | 64 | 0 | 105 | 54 (51%) | 55 (52%) |
| 22 | 27 | 30 | 22 | 2 | 81 | 44 (54%) | 50 (62%) |
| 23 | 3 | 16 | 21 | 1 | 41 | 31 (76%) | 33 (80%) |
| **Total** | **697** | **515** | **600** | **12** | **1824** | 1400 (77%) | 1078 (59%) |

Every district has at least 5 bars.

### Opening hours and websites by type

| Type | Bars | Opening hours | Website |
|---|---|---|---|
| Pub/Bar | 697 | 475 (68%) | 324 (46%) |
| Gasthaus/Beisl | 515 | 425 (83%) | 406 (79%) |
| Café/Heuriger | 600 | 492 (82%) | 338 (56%) |
| Spezial | 12 | 8 (67%) | 10 (83%) |

## Official bars

All 59 venues from both lists are in the bar list. 40 (68%) were already in the OSM import; the rest were added. Newest edition (2026-10): 33 of 51 in the import.

| How | Count |
|---|---|
| in import | 40 |
| added from OSM | 18 |
| added to extra_bars.csv | 1 |

Official bars the import didn't contain, and why:

| Bezirk | Name | OSM tagging | Why the import missed it |
|---|---|---|---|
| 3 | Marx Bier und Mehr | amenity=restaurant | restaurant without cuisine tag or Gasthaus-type name |
| 3 | Mio am Stadtpark | amenity=restaurant, cuisine=pizza | restaurant with non-Austrian cuisine |
| 4 | Wombats Bar | hostel | not a pub, bar, café or restaurant in OSM |
| 7 | Replugged | amenity=nightclub | not a pub, bar, café or restaurant in OSM |
| 8 | Cafe Carina | amenity=nightclub | not a pub, bar, café or restaurant in OSM |
| 10 | Das Columbus | amenity=restaurant | restaurant without cuisine tag or Gasthaus-type name |
| 10 | Boulderbar Hauptbahnhof | leisure=sports_centre | not a pub, bar, café or restaurant in OSM |
| 16 | Ottakringer Shop | alcohol | not a pub, bar, café or restaurant in OSM |
| 18 | Wilder Mann | amenity=restaurant | restaurant without cuisine tag or Gasthaus-type name |
| 20 | Boulderbar Hannovergasse | leisure=sports_centre | not a pub, bar, café or restaurant in OSM |
| 21 | Gasthaus Emerich | – | not in OSM |
| 21 | Leopoldauer Alm | amenity=restaurant | restaurant without cuisine tag or Gasthaus-type name |
| 22 | Boulderbar Seestadt | leisure=sports_centre | not a pub, bar, café or restaurant in OSM |
| 22 | Mio - A Piece of Neapel | amenity=restaurant, cuisine=italian | restaurant with non-Austrian cuisine |
| 23 | Restaurant Karl-Wirt | hotel | outside Vienna |
| 2 | Volee | amenity=restaurant | restaurant without cuisine tag or Gasthaus-type name |
| 5 | Thell Restaurant | amenity=restaurant | restaurant without cuisine tag or Gasthaus-type name |
| 21 | Schabanack | amenity=restaurant | restaurant without cuisine tag or Gasthaus-type name |
| 22 | Restaurant Sternberg | amenity=restaurant | restaurant without cuisine tag or Gasthaus-type name |

The *restaurant without cuisine tag* cases are classic Wirtshäuser. The spec's rule drops untagged restaurants, so similar non-official Wirtshäuser are missing too. One option: also keep untagged restaurants with a beer or Austrian signal on their website (Phase 4 fetches websites anyway).

## Owner decisions applied (2026-11-03)

- **Cafés narrowed (A + B + C):** removed coffee, cake and breakfast cafés (A), cafés that always close by 18:00 (B), and cafés with neither opening hours nor website (C). Heurigen and official bars are kept.
- **Food places out:** a Gasthaus or café may only list Austrian-type or neutral cuisines; one value such as pizza, sushi, kebab or asian rules it out. Pubs and bars are kept whatever they serve.
- **Untagged Wirtshäuser:** in Phase 4, restaurants without a cuisine tag get a website check for a Wirtshaus or beer signal, and those that pass are added.

## Random sample of 30

| Bezirk | Name | Type | OSM | Opening hours | Website | Official |
|---|---|---|---|---|---|---|
| 1 | Dom Schnitzel | Gasthaus/Beisl | amenity=restaurant, cuisine=austrian | Mo-Su 10:00-24:00 | ja | – |
| 1 | Melker Stiftskeller | Gasthaus/Beisl | amenity=restaurant, cuisine=regional | Tu-Sa 17:00-23:30 | ja | – |
| 1 | Truth and Dare | Pub/Bar | amenity=bar | Tu-Sa 18:00-02:00; Su 18:00-01:00 | ja | – |
| 1 | Wrenkh | Gasthaus/Beisl | amenity=restaurant, cuisine=regional | Mo-Fr 11:00-23:00; Sa 12:00-23:00 | ja | – |
| 1 | burg.ring1 | Café/Heuriger | amenity=cafe | Mo-We 11:00-22:00; Th-Sa 11:00-24:00; … | ja | – |
| 2 | Das GEHSTEIG | Pub/Bar | amenity=pub | Mo-Th 17:00-01:00; Fr-Sa 17:00-02:00; … | ja | – |
| 2 | Stuwer | Gasthaus/Beisl | amenity=restaurant, cuisine=regional | Mo-Sa 17:30-23:00; Su,PH 12:00-22:00 | ja | – |
| 4 | Schikaneder | Pub/Bar | amenity=bar | Mo-We 17:00-01:00, Fr,Sa 17:00-04:00, … | ja | – |
| 4 | Sekt Comptoir | Pub/Bar | amenity=bar | We,Th 17:00-23:00; Fr 15:00-23:00; Sa … | ja | – |
| 4 | Wiener Blut | Pub/Bar | amenity=bar | – | – | – |
| 4 | Wiener Wiaz'haus | Gasthaus/Beisl | amenity=restaurant, cuisine=austrian | Mo-Fr 17:00-22:00; Sa,Su off "Variable… | ja | – |
| 5 | Waldviertlerhof | Gasthaus/Beisl | amenity=restaurant, cuisine=regional | Mo-Sa 11:00-23:00 | ja | – |
| 6 | Gönnerbar | Pub/Bar | amenity=bar | – | – | – |
| 7 | Ulrich | Gasthaus/Beisl | amenity=restaurant, cuisine=regional | Mo-Fr 07:30-25:00; Sa-Su, PH 09:00-25:00 | ja | – |
| 9 | Uni Alm | Pub/Bar | amenity=bar | Mo-Sa 20:00-02:00 | – | – |
| 10 | Cafe Susi und Strolch(i) | Café/Heuriger | amenity=cafe | Mo-Sa 09:00-22:00 | – | – |
| 11 | Harrys Augustin | Café/Heuriger | amenity=restaurant, cuisine=regional;heuriger | – | ja | – |
| 12 | Golden Harp Irish Pub | Pub/Bar | amenity=pub, cuisine=burger;sandwich | Mo-Sa 10:00-02:00, PH,Su 10:00-24:00 | ja | – |
| 13 | Gasthaus Tirolergarten | Gasthaus/Beisl | amenity=restaurant, cuisine=regional | "ab 10:00, abhängig von Öffnungszeiten… | ja | 2026-04, 2026-10 |
| 14 | Peschta | Gasthaus/Beisl | amenity=restaurant, cuisine=regional | Mo-Fr 09:00-23:00 | ja | – |
| 15 | Cafe Kriemhild | Café/Heuriger | amenity=cafe | Su-Th 10:00-00:00; Fr-Sa 10:00-02:00 | – | – |
| 15 | Café Caché | Café/Heuriger | amenity=cafe | Mo, Tu 09:00 - 17:00, We - Fr 09:00 - … | ja | – |
| 15 | Exil in der Märzstraße | Pub/Bar | amenity=pub | Mo-Th 17:00-02:00; Fr 17:00-04:00; Sa … | ja | – |
| 16 | Palladium | Café/Heuriger | amenity=cafe | Tu-Fr 09:00-21:00; Sa 06:00-18:00; Su,… | – | – |
| 16 | Schutzhaus Gartenfreunde Ottakring | Gasthaus/Beisl | amenity=restaurant, cuisine=regional | Fr-Tu 11:00-22:00; We,Th off | ja | – |
| 17 | Laby | Café/Heuriger | amenity=cafe | – | ja | – |
| 19 | Aristo Bar | Pub/Bar | amenity=bar | Mo-Sa 21:00-04:00 | – | – |
| 19 | Grüass Di a Gott Wirt | Gasthaus/Beisl | amenity=restaurant | Tu-Fr 11:00-20:00; Sa,Su,PH 10:00-20:00 | ja | – |
| 22 | Queen Eßling | Gasthaus/Beisl | amenity=restaurant, cuisine=regional | – | ja | – |
| 23 | Genussspiegel | Café/Heuriger | amenity=cafe | – | ja | – |
