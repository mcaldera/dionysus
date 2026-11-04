# Dionysus – Seidl-Tour-Planer

A website for planning a Vienna **"Seidl" tour**: one small beer in every district (all 23, or a subset you choose), travelling on foot and by public transport. You pick a starting point, the tool suggests bars that are close, well connected and to your group's taste, or builds a complete route you can then adjust.

The interface is in German. It is a static site: no backend, no accounts, no live data.

> Not an official offering of the Ottakringer Brauerei. Tags are subjective opinions.

## What it does

Three questions it tries to answer better than a normal maps app:

1. **Where should we start**, and which bar there leads to a good tour?
2. **From this bar, which next bars** are close, well connected and to our taste?
3. **What does a complete, feasible tour look like?**

Two ways to plan:

- **Step by step:** click a bar on the map, see its details and the best next bars highlighted, then add it to the tour.
- **Propose a full tour:** get a whole route straight away and swap individual bars.

Other features: filter by venue type, tags (e.g. *Urig*, *Gastgarten*, *Live-Musik*) and opening time. Enter each participant's likes and dislikes (a dislike ranks a bar lower, it never hides it). Split a tour over several days. Plans are saved in your browser and can be shared as a link.

## Where the information comes from

Everything is prepared **offline** by a pipeline and shipped to the site as plain data files.

| What | Source |
|---|---|
| **Bars and pubs** (names, locations, opening hours, websites) | [OpenStreetMap](https://www.openstreetmap.org/) (Geofabrik Austria extract). Venues are sorted into types: Bar & Pub, Tschocherl & Café-Bar, Beisl & Wirtshaus, Heuriger, and special venues. Coffee houses, confectioners and non-Austrian restaurants are left out |
| **"Official" partner bars** | The Ottakringer Seidlwandertage booklets, matched to the OSM bars. Facts only, no copied descriptions |
| **Districts** | City of Vienna open data boundaries; each bar is assigned to a district by its coordinates |
| **Travel times** | Computed from timetables: street network from OSM plus public-transport schedules (Wiener Linien, and ÖBB for S-Bahn) using [r5py](https://r5py.readthedocs.io/). Times are the median over a Saturday daytime window, so waiting is included. Walking and transit matrices for every pair of bars |
| **Walk or transit?** | A leg is walked if that's at most ~5 minutes slower than transit; otherwise transit is used and the usual range is shown |
| **Tags** | Computed where possible (e.g. *Lang offen* from opening hours), otherwise derived from OSM tags and the bars' own websites, plus hand-made tips. Untagged bars stay selectable and are marked as such |
| **Drawn routes** (display only) | Walking: [FOSSGIS OSRM](https://routing.openstreetmap.de/); transit lines: [Transitous](https://transitous.org/) |
| **Map** | [MapLibre](https://maplibre.org/) with [OpenFreeMap](https://openfreemap.org/) tiles |

Google's APIs are deliberately not used; each leg and bar just links out to Google Maps.

## How the recommendations work

When you click a bar, every other candidate gets a score from four parts:

- **Closeness:** travel time from the selected bar
- **Tour fit:** how much the detour costs the remaining tour
- **Match:** how well its tags fit the group's likes and dislikes
- **Similarity:** similar or deliberately different to the current bar

A slider trades speed against taste. The top five appear numbered on the map, each with a short reason such as "6 Min. zu Fuß · Urig".

## How a full tour is built

Choosing one bar per district in a good order is a travelling-salesman-style problem. The solver picks a shortlist of bars per district, searches for a good district order (local search), and chooses the best bar per district for that order, taking opening hours into account. Bars that are closed on arrival are penalised rather than forbidden, so a tour always exists, with a warning where needed. It runs in a Web Worker in your browser.

## Repository layout

```text
pipeline/   Python (+ one Node step) data pipeline: fetch, import bars, match
            official lists, opening hours, travel-time matrices, build site data
data/own/   hand-maintained inputs (official lists, tags, extra bars, overrides)
src/        React + TypeScript app; src/domain holds the scoring and solver logic
public/data generated data the site loads (bars, districts, travel matrices)
reports/    check reports from the pipeline stages
SPEC.md     detailed design and decisions
```

## Running it

```bash
npm install
npm run dev        # development server
npm run build      # production build
npm test           # unit tests
npm run test:e2e   # Playwright tests
```

Regenerating the data needs the Python environment in `environment.yml` (including a JDK 21+ for r5py) and the scripts in `pipeline/`, run in numeric order. The large raw downloads are not part of the repository.

## Data licences

Bar data is derived from OpenStreetMap (© OpenStreetMap contributors, ODbL). Timetables: Wiener Linien (CC BY), ÖBB. Map tiles: OpenFreeMap / OpenMapTiles. See `SPEC.md` for details.
