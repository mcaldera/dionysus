// Loads the static data from public/data/ (SPEC 3).

import type { Matrices } from './domain/travel'
import type { Bar, Manifest } from './domain/types'

const BASE = `${import.meta.env.BASE_URL}data/`

async function bin(name: string): Promise<Uint8Array> {
  const r = await fetch(`${BASE}travel/${name}.bin`)
  if (!r.ok) throw new Error(`${name}.bin: ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

async function json<T>(name: string): Promise<T> {
  const r = await fetch(`${BASE}${name}`)
  if (!r.ok) throw new Error(`${name}: ${r.status}`)
  return r.json() as Promise<T>
}

export interface SiteData {
  manifest: Manifest
  bars: Bar[]
  districts: GeoJSON.FeatureCollection
  districtLabels: GeoJSON.FeatureCollection
  /** Everything outside Vienna, greyed out on the map. */
  viennaMask: GeoJSON.FeatureCollection
  matrices: Matrices
}

/** The solver only needs walk and transit_p50; p25 and p75 are for display (SPEC 5.7). */
export async function loadSiteData(): Promise<SiteData> {
  const [manifest, bars, districts, districtLabels, viennaMask, walk, transitP50] = await Promise.all([
    json<Manifest>('manifest.json'),
    json<Bar[]>('bars.json'),
    json<GeoJSON.FeatureCollection>('districts.geojson'),
    json<GeoJSON.FeatureCollection>('district_labels.geojson'),
    json<GeoJSON.FeatureCollection>('vienna_mask.geojson'),
    bin('walk'),
    bin('transit_p50'),
  ])
  return { manifest, bars, districts, districtLabels, viennaMask, matrices: { n: manifest.n, walk, transitP50 } }
}

export async function loadTransitRange(): Promise<[Uint8Array, Uint8Array]> {
  return Promise.all([bin('transit_p25'), bin('transit_p75')])
}
