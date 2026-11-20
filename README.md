# Wiener Durst (Dionysus)

**A route planner for Vienna's Seidlwandertage, built around open geodata, public-transport schedules, and route optimisation.**

[Try the live app](https://wiener-durst.mcaldera.workers.dev/) · [Design and data notes](SPEC.md)

![The Atlas arranges Vienna venues into clusters by profile similarity](docs/atlas-preview.png)

<sub>The Atlas can switch between t-SNE, UMAP, and PCA layouts.</sub>

One Seidl per district; the interesting challenge is making a route across all 23 that works for the group and the opening hours. The interface is in German.

## What it does

- Explore Vienna venues by district, type, tags, and opening hours.
- Get next-stop suggestions that balance journey time, the remaining tour, and the group's preferences.
- Build a tour with one venue per selected district, adjust individual stops, and split long tours across days.
- Explore the **Atlas**, where similar venue profiles sit near each other and form interactive, labelled clusters.
- Optionally share ratings, comments, and lists with a group; the planner itself remains usable without the API.

## Technical highlights

### Schedule-aware route optimisation

The full-tour planner is a generalized travelling-salesperson problem: choose one venue per district, then find a good order while accounting for journey time, opening hours, and group match. A dynamic programme chooses venues for a fixed district order; a seeded multi-start local search (2-opt and Or-opt moves) improves the order. The solver runs in a Web Worker so the map stays responsive.

This is a fast heuristic, not a claim of a mathematically guaranteed shortest tour. It considers the whole remaining route instead of greedily picking the nearest next stop.

### From geodata to travel times

An offline pipeline combines venue and street data with public-transport schedules and builds travel-time matrices between venues. The planner uses those estimates for recommendations and tour optimisation. Walking is preferred when it is close in time to transit; otherwise the itinerary uses transit.

### A map of venue similarity

Venue profiles become compact vectors used for similarity and recommendations. The Atlas lays them out with **t-SNE, UMAP, or PCA**, then lets you explore clusters at different levels and inspect venues near a selected bar. These are different views of profile similarity, not geographic positions.

## Data, limits, and attribution

- Venue and street data: [OpenStreetMap](https://www.openstreetmap.org/) (ODbL).
- District boundaries: City of Vienna open data.
- Official partner venues: published Seidlwandertage lists; facts only, not copied descriptions.
- Travel times: precomputed from street-network data and Wiener Linien / ÖBB schedules. They use a Saturday daytime window and include expected waiting time.
- Displayed walking and transit paths: [FOSSGIS OSRM](https://routing.openstreetmap.de/) and [Transitous](https://transitous.org/). These draw a route for display; the planner's estimated journey times come from its matrices.
- Map tiles: [OpenFreeMap](https://openfreemap.org/) / OpenMapTiles.

Source terms differ. The repository excludes large raw downloads and fetched website text; it contains processed site data and curated build inputs. See [SPEC.md](SPEC.md) for source notes and attribution, and check the relevant terms before reusing generated data. Google Maps, where linked, is an external venue link rather than the routing engine.

This is an independent project, not an official offering of Ottakringer or any listed venue. Tags and recommendations are subjective.

## Built with

- **Frontend:** React, TypeScript, Vite, MapLibre
- **Data pipeline:** Python and Node.js; geospatial and timetable processing
- **Route solver:** TypeScript in a Web Worker
- **Optional group features:** Cloudflare Worker and D1

## Repository layout

```text
pipeline/   data ingestion, travel-time matrices, and site-data generation
src/        React app, recommendations, Atlas, and route solver
api/        optional Cloudflare Worker for group features
public/data generated venue, map, and travel-time data
data/own/   curated inputs used by the build
SPEC.md     design decisions, pipeline details, and source notes
```

## Run locally

```bash
npm install
npm run dev
npm run build
npm test
npm run test:e2e
```

Regenerating the datasets requires the Python environment in `environment.yml` and a JDK 21+ for r5py. Pipeline steps are documented in `SPEC.md`.
