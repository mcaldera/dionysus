import { describe, expect, it } from 'vitest'
import { areaKm2 } from './districtStats'
import { nearbyFromBar, nearbyFromPoint, reachFromBar, walkEstimate } from './nearby'
import type { Matrices } from './travel'
import type { Bar } from './types'

function bar(i: number, lon: number, weeklyOpen: Bar['weeklyOpen'] = null): Bar {
  return {
    id: `own:n${i}`, matrixIndex: i, name: `N${i}`, district: i + 1, lat: 48.2, lon, venueType: 'pub_bar',
    weeklyOpen, official: [], tags: [], unreviewedTags: [],
  }
}

// Bars on a line 500 m apart (0.0067° of longitude at 48.2°); walking 8 min per step, transit 4.
const bars = [0, 1, 2, 3].map((i) => bar(i, 16.30 + i * 0.0067))
const n = bars.length
const walk = new Uint8Array(n * n)
const transit = new Uint8Array(n * n)
for (let u = 0; u < n; u++) for (let v = 0; v < n; v++) { walk[u * n + v] = 8 * Math.abs(u - v); transit[u * n + v] = 4 * Math.abs(u - v) }
const m: Matrices = { n, walk, transitP50: transit }
const opts = { maxMinutes: 10, transit: false, walkToleranceMinutes: 0, departure: null }

describe('nearby', () => {
  it('walking only keeps the budget, any district', () => {
    expect(nearbyFromBar(bars[0], bars, m, opts).map((r) => r.bar.id)).toEqual(['own:n1'])
  })

  it('the way to one bar matches the list', () => {
    expect(reachFromBar(bars[0], bars[2], m, { transit: false, walkToleranceMinutes: 0 })).toEqual({ minutes: 16, mode: 'walk' })
    expect(reachFromBar(bars[0], bars[2], m, { transit: true, walkToleranceMinutes: 0 })).toEqual({ minutes: 8, mode: 'transit' })
  })

  it('with transit reaches further', () => {
    const r = nearbyFromBar(bars[0], bars, m, { ...opts, transit: true })
    expect(r.map((x) => x.minutes)).toEqual([4, 8])
    expect(r[0].mode).toBe('transit')
  })

  it('leaves out bars known to be closed on arrival, keeps unknown hours', () => {
    const closed = [bars[0], bar(1, bars[1].lon, [])]
    expect(nearbyFromBar(closed[0], closed, m, { ...opts, departure: 600 })).toHaveLength(0)
    expect(nearbyFromBar(bars[0], bars, m, { ...opts, departure: 600 })[0].open).toBeNull()
    expect(nearbyFromBar(bars[0], bars, m, { ...opts, departure: 600, includeUnknownHours: false })).toHaveLength(0)
  })

  it('estimates walking from a free point and uses nearby bars for transit', () => {
    const home = { lat: 48.2, lon: 16.30 }
    expect(walkEstimate(home, bars[1])).toBe(8)
    const r = nearbyFromPoint(home, bars, m, { ...opts, maxMinutes: 9, transit: true })
    expect(r.map((x) => x.bar.id)).toEqual(['own:n0', 'own:n1', 'own:n2'])
    // Riding must save more than the tolerance; with 5 minutes, bar 1 (8 walk, 4 ride) is walked.
    const t5 = nearbyFromPoint(home, bars, m, { ...opts, maxMinutes: 30, transit: true, walkToleranceMinutes: 5 })
    expect(t5.find((x) => x.bar.id === 'own:n1')?.mode).toBe('walk')
    expect(t5.find((x) => x.bar.id === 'own:n3')).toMatchObject({ mode: 'transit', minutes: 12 })
  })
})

describe('areaKm2', () => {
  it('is about 1 km² for a 1 km square', () => {
    const dLat = 1 / 111.32
    const dLon = 1 / (111.32 * Math.cos((48.2 * Math.PI) / 180))
    const sq: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[16, 48.2], [16 + dLon, 48.2], [16 + dLon, 48.2 + dLat], [16, 48.2 + dLat], [16, 48.2]]] }
    expect(areaKm2(sq)).toBeCloseTo(1, 2)
  })
})

describe('reachFromPoint', () => {
  it('walks when walking only, rides when transit is clearly faster', async () => {
    const { reachFromPoint } = await import('./nearby')
    const home = { lat: 48.2, lon: 16.30 }
    expect(reachFromPoint(home, bars[3], bars, m, { transit: false, walkToleranceMinutes: 0 })).toEqual({ minutes: 24, mode: 'walk' })
    expect(reachFromPoint(home, bars[3], bars, m, { transit: true, walkToleranceMinutes: 0 })).toEqual({ minutes: 12, mode: 'transit' })
  })
})
