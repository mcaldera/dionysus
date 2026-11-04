// Figures for one district, shown when it is clicked on the map.

import { strongTips } from './filter'
import { isOpenAt } from './hours'
import type { Matrices } from './travel'
import { VENUE_TYPES, type Bar, type Tag, type VenueType } from './types'

export interface DistrictStats {
  count: number
  areaKm2: number
  perKm2: number
  byType: { type: VenueType; count: number }[]
  /** Share known open at `at`, and share with unknown hours. */
  openShare: number
  unknownShare: number
  tagCounts: Partial<Record<Tag, number>>
  /** Up to five bars with strong tips or on the official list. */
  tipped: Bar[]
  tippedCount: number
  /** Median walk from a bar to its nearest other bar in the district. */
  medianNearestWalk: number | null
  /** Median walk between two bars of the district. */
  medianPairWalk: number | null
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Area of a (multi)polygon in km², projected at Vienna's latitude. */
export function areaKm2(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
  const k = Math.cos((48.2 * Math.PI) / 180)
  const ring = (r: number[][]) => {
    let a = 0
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      a += (r[j][0] * k * 111.32) * (r[i][1] * 111.32) - (r[i][0] * k * 111.32) * (r[j][1] * 111.32)
    }
    return Math.abs(a) / 2
  }
  const poly = (p: number[][][]) => ring(p[0]) - p.slice(1).reduce((s, h) => s + ring(h), 0)
  return geometry.type === 'Polygon' ? poly(geometry.coordinates) : geometry.coordinates.reduce((s, p) => s + poly(p), 0)
}

export function districtStats(
  district: number, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null, all: Bar[], m: Matrices,
  at: number,
): DistrictStats {
  const bars = all.filter((b) => b.district === district)
  const area = geometry ? areaKm2(geometry) : 0
  const byType = VENUE_TYPES.map((type) => ({ type, count: bars.filter((b) => b.venueType === type).length }))
    .filter((t) => t.count).sort((a, b) => b.count - a.count)
  const open = bars.map((b) => isOpenAt(b.weeklyOpen, at))
  const tagCounts: Partial<Record<Tag, number>> = {}
  for (const b of bars) for (const t of b.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1
  const tipped = bars.filter((b) => strongTips(b).length || b.official.length)
    .sort((a, b) => strongTips(b).length - strongTips(a).length || b.official.length - a.official.length)

  const nearest: number[] = []
  const pairs: number[] = []
  for (const a of bars) {
    let best = 255
    for (const b of bars) {
      if (a === b) continue
      const w = m.walk[a.matrixIndex * m.n + b.matrixIndex]
      if (w < best) best = w
      if (a.matrixIndex < b.matrixIndex && w < 255) pairs.push(w)
    }
    if (best < 255) nearest.push(best)
  }

  return {
    count: bars.length,
    areaKm2: area,
    perKm2: area ? bars.length / area : 0,
    byType,
    openShare: bars.length ? open.filter((x) => x === true).length / bars.length : 0,
    unknownShare: bars.length ? open.filter((x) => x === null).length / bars.length : 0,
    tagCounts,
    tipped: tipped.slice(0, 5),
    tippedCount: tipped.length,
    medianNearestWalk: median(nearest),
    medianPairWalk: median(pairs),
  }
}
