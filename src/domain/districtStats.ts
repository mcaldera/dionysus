// Figures for one district, shown when it is clicked on the map.

import { strongTips } from './filter'
import { isOpenAt } from './hours'
import { SCORE_TAGS, VENUE_TYPES, type Bar, type Tag, type VenueType } from './types'

/** A 0-100 score in the district: its median, Vienna's, and the district's rank (1 = highest). */
export interface ScoreSummary {
  median: number
  vienna: number
  rank: number
  /** Districts ranked (those with enough bars that have the score). */
  of: number
  /** Lowest and highest district median, the ends of the scale in the card. */
  min: number
  max: number
}

export interface DistrictStats {
  count: number
  areaKm2: number
  perKm2: number
  byType: { type: VenueType; count: number }[]
  /** Share known open at `at`, and share with unknown hours. */
  openShare: number
  unknownShare: number
  tagCounts: Partial<Record<Tag, number>>
  /** The most common character tags (no score tags), most frequent first. */
  topTags: { tag: Tag; count: number }[]
  popularity: ScoreSummary | null
  satisfaction: ScoreSummary | null
  /** Bars with popularity ≥ 90 ("Publikumsmagnet"), and the score tags. */
  magnets: number
  scoreTagCounts: Partial<Record<Tag, number>>
  /** Up to three bars each: most popular, best rated, Geheimtipps. */
  mostPopular: Bar[]
  bestRated: Bar[]
  gems: Bar[]
  /** Up to five bars with strong tips or on the official list. */
  tipped: Bar[]
  tippedCount: number
}

/** Districts need this many bars with a score to get a median and a rank. */
const MIN_SCORED = 5

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

function scoreSummary(district: number, all: Bar[], key: 'popularity' | 'satisfaction'): ScoreSummary | null {
  const byDistrict = new Map<number, number[]>()
  for (const b of all) {
    const v = b[key]
    if (v == null) continue
    const list = byDistrict.get(b.district) ?? []
    list.push(v)
    byDistrict.set(b.district, list)
  }
  const medians = [...byDistrict].filter(([, v]) => v.length >= MIN_SCORED).map(([d, v]) => [d, median(v)!] as const)
  const mine = medians.find(([d]) => d === district)
  if (!mine) return null
  const vienna = median(all.flatMap((b) => (b[key] == null ? [] : [b[key]!])))!
  const values = medians.map(([, v]) => v)
  return {
    median: mine[1], vienna, rank: 1 + medians.filter(([, v]) => v > mine[1]).length, of: medians.length,
    min: Math.min(...values), max: Math.max(...values),
  }
}

export function districtStats(
  district: number, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null, all: Bar[], at: number,
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

  const topTags = Object.entries(tagCounts).filter(([t]) => !SCORE_TAGS.includes(t as Tag))
    .map(([tag, count]) => ({ tag: tag as Tag, count: count! })).sort((a, b) => b.count - a.count)
  const scoreTagCounts = Object.fromEntries(SCORE_TAGS.map((t) => [t, tagCounts[t] ?? 0]))
  const by = (f: (b: Bar) => number) => (a: Bar, b: Bar) => f(b) - f(a)
  const scored = bars.filter((b) => b.popularity != null)

  return {
    count: bars.length,
    areaKm2: area,
    perKm2: area ? bars.length / area : 0,
    byType,
    openShare: bars.length ? open.filter((x) => x === true).length / bars.length : 0,
    unknownShare: bars.length ? open.filter((x) => x === null).length / bars.length : 0,
    tagCounts,
    topTags: topTags.slice(0, 8),
    popularity: scoreSummary(district, all, 'popularity'),
    satisfaction: scoreSummary(district, all, 'satisfaction'),
    magnets: bars.filter((b) => (b.popularity ?? 0) >= 90).length,
    scoreTagCounts,
    mostPopular: [...scored].sort(by((b) => b.popularity!)).slice(0, 3),
    // Well rated and also known: satisfaction first, popularity breaks ties.
    bestRated: [...scored].filter((b) => b.satisfaction != null)
      .sort(by((b) => b.satisfaction! * 1000 + b.popularity!)).slice(0, 3),
    gems: bars.filter((b) => b.tags.includes('geheimtipp')).sort(by((b) => b.geheimtipp ?? 0)).slice(0, 3),
    tipped: tipped.slice(0, 5),
    tippedCount: tipped.length,
  }
}
